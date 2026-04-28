# Node fs Reference

> Source: https://nodejs.org/api/fs.html
> Source: https://nodejs.org/api/fs.json
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

The `node:fs` module provides file-system operations modeled on POSIX functions. Node exposes synchronous, callback, and promise-based forms. In ESM code, the promise API is imported from `node:fs/promises`; callback and sync APIs are imported from `node:fs`.

The promises API is stable and runs file-system operations through Node's underlying threadpool. Node docs warn that these operations are not synchronized or threadsafe, so concurrent modifications to the same file require care.

## Core Concepts

Promise API: use `import * as fs from 'node:fs/promises'` or named imports such as `readFile`, `writeFile`, `mkdir`, and `rm`.

Callback API: the callback form receives an error as the first callback argument. Node docs state callback APIs can be preferable when maximum performance and lower allocation matter.

Sync API: synchronous operations block the event loop and throw immediately.

FileHandle: returned by `fsPromises.open()`. Node docs advise explicitly closing file handles instead of relying on automatic cleanup.

Path types: many promise APIs accept `string | Buffer | URL`; some also accept `FileHandle`.

## API / Interface

### Import Forms

```ts
import * as fs from 'node:fs/promises';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import * as callbackFs from 'node:fs';
```

### Promise Methods

| Signature | Return | Notes |
| --- | --- | --- |
| `fsPromises.access(path[, mode])` | `Promise<void>` | Tests permissions. Default mode is `fs.constants.F_OK`. |
| `fsPromises.copyFile(src, dest[, mode])` | `Promise<void>` | Copies a file; destination is overwritten by default. |
| `fsPromises.mkdir(path[, options])` | `Promise<undefined | string>` | Creates a directory. With `recursive: true`, resolves with first created path. |
| `fsPromises.mkdtemp(prefix[, options])` | `Promise<string>` | Creates a unique temp directory by appending random characters to `prefix`. |
| `fsPromises.mkdtempDisposable(prefix[, options])` | `Promise<AsyncDisposable>` | Creates a temp directory object with `path` and async `remove()`. |
| `fsPromises.open(path, flags[, mode])` | `Promise<FileHandle>` | Opens a file handle. Default flag is `'r'`. |
| `fsPromises.opendir(path[, options])` | `Promise<fs.Dir>` | Opens a directory for iterative scanning. |
| `fsPromises.readdir(path[, options])` | `Promise<string[] | Buffer[] | fs.Dirent[]>` | Reads directory names; `withFileTypes` returns `Dirent` objects. |
| `fsPromises.readFile(path[, options])` | `Promise<string | Buffer>` | Reads an entire file. Encoding controls string vs buffer output. |
| `fsPromises.rename(oldPath, newPath)` | `Promise<void>` | Renames or moves a path. |
| `fsPromises.rmdir(path[, options])` | `Promise<void>` | Removes a directory. Recursive use is deprecated/removed; use `rm`. |
| `fsPromises.rm(path[, options])` | `Promise<void>` | Removes files/directories, modeled on POSIX `rm`. |
| `fsPromises.stat(path[, options])` | `Promise<fs.Stats | undefined>` | Reads stats; `throwIfNoEntry: false` can return `undefined`. |
| `fsPromises.statfs(path[, options])` | `Promise<fs.StatFs>` | Reads file-system stats. |
| `fsPromises.unlink(path)` | `Promise<void>` | Removes a file or symlink. |
| `fsPromises.writeFile(file, data[, options])` | `Promise<void>` | Writes data, replacing existing file by default. |

### Common Option Objects

| Method | Options |
| --- | --- |
| `mkdir` | `recursive?: boolean` default `false`; `mode?: string | integer` default `0o777`, not supported on Windows. |
| `mkdtemp` | `encoding?: string` default `utf8`. |
| `opendir` | `encoding?: string | null` default `utf8`; `bufferSize?: number` default `32`; `recursive?: boolean` default `false`. |
| `readdir` | `encoding?: string` default `utf8`; `withFileTypes?: boolean` default `false`; `recursive?: boolean` default `false`. |
| `readFile` | `encoding?: string | null` default `null`; `flag?: string` default `'r'`; `signal?: AbortSignal`. |
| `rm` | `force?: boolean` default `false`; `recursive?: boolean` default `false`; `maxRetries?: integer` default `0`; `retryDelay?: integer` default `100`. |
| `stat` | `bigint?: boolean` default `false`; `throwIfNoEntry?: boolean` default `true`. |
| `writeFile` | `encoding?: string | null` default `utf8`; `mode?: integer` default `0o666`; `flag?: string` default `'w'`; `flush?: boolean` default `false`; `signal?: AbortSignal`. |

### Access Constants

| Constant | Meaning |
| --- | --- |
| `fs.constants.F_OK` | Path is visible to the process. Default mode for `access`. |
| `fs.constants.R_OK` | Path can be read. |
| `fs.constants.W_OK` | Path can be written. |
| `fs.constants.X_OK` | Path can be executed. On Windows this behaves like `F_OK`. |

### Common File Flags

| Flag | Meaning |
| --- | --- |
| `'r'` | Open for reading; fail if missing. |
| `'r+'` | Open for reading and writing; fail if missing. |
| `'w'` | Open for writing; create or truncate. |
| `'wx'` | Like `'w'`, but fail if path exists. |
| `'a'` | Open for appending; create if missing. |
| `'ax'` | Like `'a'`, but fail if path exists. |
| `'a+'` | Open for reading and appending; create if missing. |

## Usage Patterns

### Ensure a Directory Exists

```ts
import {mkdir} from 'node:fs/promises';

await mkdir(outputDir, {recursive: true});
```

### Read JSON Beside an ES Module

```ts
import {readFile} from 'node:fs/promises';

const fileUrl = new URL('./package.json', import.meta.url);
const json = JSON.parse(await readFile(fileUrl, 'utf8'));
```

### Write Text and Replace Existing Content

```ts
import {writeFile} from 'node:fs/promises';

await writeFile(path, text, {encoding: 'utf8'});
```

### Remove a Temporary Directory Tree

```ts
import {rm} from 'node:fs/promises';

await rm(tempDir, {recursive: true, force: true});
```

### Create a Temp Directory Under the OS Temp Root

```ts
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'tuitube-'));
```

### Iterate Directory Entries With Types

```ts
import {readdir} from 'node:fs/promises';

const entries = await readdir(dir, {withFileTypes: true});
for (const entry of entries) {
  if (entry.isFile()) {
    console.log(entry.name);
  }
}
```

## Configuration

There is no module-level config. Behavior is controlled per call with path arguments, flags, and option objects.

Important defaults:

| API | Default |
| --- | --- |
| `readFile` encoding | `null`, so output is a `Buffer`. |
| `writeFile` encoding | `utf8`. |
| `writeFile` flag | `'w'`, so existing files are replaced. |
| `mkdir` recursive | `false`. |
| `rm` force | `false`. |
| `rm` recursive | `false`. |
| `stat` throwIfNoEntry | `true`. |

## Best Practices

1. Prefer `node:fs/promises` for application code that already uses `async`/`await`.
2. Avoid sync APIs in interactive commands, servers, or long-running UI flows because they block the event loop.
3. Do not use `access()` as a preflight before `open()`, `readFile()`, or `writeFile()`; Node docs warn this introduces a race. Perform the operation and handle the error.
4. Close `FileHandle` objects explicitly with `filehandle.close()`.
5. Await each `writeFile()` or `filehandle.writeFile()` on the same file before starting another write to that file.
6. Use streams instead of `writeFile()` for performance-sensitive large writes.
7. Use `rm(path, {recursive: true, force: true})` for `rm -rf` behavior.
8. Ensure an `mkdtemp()` prefix ends with a path separator when the directory should be created inside a parent directory.

## Common Pitfalls

`readFile()` returns a `Buffer` unless an encoding is provided.

`writeFile()` replaces existing files by default because its default flag is `'w'`.

Aborting `readFile()` or `writeFile()` stops Node's internal buffering on a best-effort basis; it does not cancel individual operating-system requests already in progress.

`readFile()` on a directory is platform-specific: docs state macOS, Linux, and Windows reject, while FreeBSD may return a representation of directory contents.

`rmdir(path, {recursive: true})` is not the modern recursive deletion API. Use `rm()`.

The exclusive `'x'` flag can be unreliable on network file systems, per the file flags notes.

On Windows, opening an existing hidden file with `'w'` can fail with `EPERM`; use `'r+'` when modifying it.

## Version Notes

This reference was generated from the online Node `fs` docs on 2026-04-27.

The docs mark the `File system` module as stable.

`fs/promises` was added in Node v10.0.0, exposed as `require('fs/promises')` in v14.0.0, and documented as no longer experimental in v10.17.0/v11.14.0.

`mkdtempDisposable()` appears in the current docs and returns an async-disposable temp directory object.
