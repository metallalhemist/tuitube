# Execa Reference

> Source: https://www.npmjs.com/package/execa
> Source: https://registry.npmjs.org/execa/latest
> Source: https://registry.npmjs.org/execa/-/execa-9.6.1.tgz
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

Execa is an ESM Node.js package for running subprocesses from scripts, applications, and libraries. The npm latest metadata fetched on 2026-04-27 reports version `9.6.1`, package type `module`, and Node engine support `^18.19.0 || >=20.5.0`.

The package wraps `child_process` for programmatic usage: argument escaping, local binary lookup, streaming, piping, IPC, cancellation, verbose logging, and typed results/errors.

## Core Concepts

Template syntax: `execa\`npm run build\`` and `$ \`...\`` parse commands without using a shell by default.

Array syntax: `execa(file, args, options)` is appropriate when arguments already exist as arrays.

Script method: `$` has script-friendly defaults and is preferred by the docs for files that execute multiple commands.

Result promise: async methods return a value that is both a subprocess object and a promise resolving to a result or rejecting with `ExecaError`.

Output control: `stdout`, `stderr`, `stdin`, `stdio`, `all`, `buffer`, `encoding`, `lines`, and `stripFinalNewline` shape stream behavior and result fields.

Failure handling: by default failed commands reject; `reject: false` resolves with a failed result instead.

## API / Interface

Exports from `index.d.ts`:

```ts
export type {Options, SyncOptions} from './types/arguments/options.js';
export type {Result, SyncResult} from './types/return/result.js';
export type {ResultPromise, Subprocess} from './types/subprocess/subprocess.js';
export {ExecaError, ExecaSyncError} from './types/return/final-error.js';
export {execa, type ExecaMethod} from './types/methods/main-async.js';
export {execaSync, type ExecaSyncMethod} from './types/methods/main-sync.js';
export {execaCommand, execaCommandSync, parseCommandString} from './types/methods/command.js';
export {$, type ExecaScriptMethod, type ExecaScriptSyncMethod} from './types/methods/script.js';
export {execaNode, type ExecaNodeMethod} from './types/methods/node.js';
export {sendMessage, getOneMessage, getEachMessage, getCancelSignal, type Message} from './types/ipc.js';
export type {VerboseObject, SyncVerboseObject} from './types/verbose.js';
```

Practical call forms:

| API | Purpose |
| --- | --- |
| `execa\`command args\`` | Execute a command from a tagged template. |
| `execa(file, arguments?, options?)` | Execute a file with an argument array. `file` may be `string | URL`; arguments are `readonly string[]`. |
| `execa(options)` | Return a bound Execa method with merged defaults. |
| `$ \`command args\`` | Script-friendly async execution. |
| `$(options)` | Return a bound script method. |
| `$.sync(...)` / `$.s(...)` | Synchronous script method. |
| `execaSync(...)` | Synchronous execution; docs discourage it because it holds the CPU and lacks multiple features. |
| `execaCommand(command, options?)` | Execute a single command string. Docs say this is for specific cases such as REPLs and should otherwise be avoided. |
| `execaCommandSync(command, options?)` | Synchronous command-string execution. |
| `execaNode(scriptPath, arguments?, options?)` | Execute a Node.js file with `node: true`. |
| `parseCommandString(command: string): string[]` | Split a command string into file/arguments. |

Async return type:

```ts
type ResultPromise<OptionsType extends Options = Options> =
  & Subprocess<OptionsType>
  & Promise<Result<OptionsType>>;
```

Result fields include `stdout`, `stderr`, `all`, `stdio`, `ipcOutput`, `pipedFrom`, `command`, `escapedCommand`, `cwd`, `durationMs`, `failed`, `timedOut`, `isCanceled`, `isGracefullyCanceled`, `isMaxBuffer`, `isTerminated`, `isForcefullyTerminated`, `exitCode`, `signal`, `signalDescription`, `message`, `shortMessage`, `originalMessage`, `cause`, and `code`.

Subprocess additions include `pid`, `stdin`, `stdout`, `stderr`, `all`, `stdio`, `kill()`, async iteration over output lines, `iterable()`, `readable()`, `writable()`, `duplex()`, IPC helpers when enabled, and `.pipe()`.

## Usage Patterns

### Run a Command and Capture stdout

```ts
import {execa} from 'execa';

const {stdout} = await execa`yt-dlp --version`;
```

### Use Explicit Arguments for User-provided Values

```ts
import {execa} from 'execa';

const result = await execa('yt-dlp', ['-J', '--no-playlist', url], {
  timeout: 30_000,
});
```

### Capture Failures Without Throwing

```ts
import {execa} from 'execa';

const result = await execa('yt-dlp', ['--list-subs', url], {
  reject: false,
  stderr: 'pipe',
});

if (result.failed) {
  console.error(result.shortMessage);
}
```

### Stream and Buffer Output at the Same Time

```ts
import {execa} from 'execa';

const {stdout} = await execa('yt-dlp', args, {
  stdout: ['pipe', 'inherit'],
  stderr: ['pipe', 'inherit'],
});
```

### Split Text Output Into Lines

```ts
import {execa} from 'execa';

const {stdout} = await execa({lines: true})`yt-dlp --list-subs ${url}`;
for (const line of stdout) {
  console.log(line);
}
```

### Cancel a Long-running Process

```ts
import {execa} from 'execa';

const controller = new AbortController();
const subprocess = execa('yt-dlp', args, {
  cancelSignal: controller.signal,
});

setTimeout(() => controller.abort(), 60_000);
await subprocess;
```

### Prefer Local Project Binaries

```ts
import {execa} from 'execa';

await execa({preferLocal: true})`eslint`;
```

## Configuration

Common `Options`:

| Option | Type / Default | Notes |
| --- | --- | --- |
| `preferLocal` | boolean; `true` with `$`, `false` otherwise | Prefer locally installed binaries. |
| `localDir` | `string | URL`; default `cwd` | Directory used for local binary lookup. |
| `node` | boolean; `true` with `execaNode()`, `false` otherwise | Run with Node.js. |
| `nodeOptions` | `readonly string[]`; default `process.execArgv` | Requires `node: true`. |
| `nodePath` | `string | URL`; default `process.execPath` | Requires `node: true`. |
| `shell` | `boolean | string | URL`; default `false` | Docs recommend against using this option. |
| `cwd` | `string | URL`; default `process.cwd()` | Subprocess working directory. |
| `env` | partial record of string values; default `process.env` | Environment variables. |
| `extendEnv` | boolean; default `true` | Whether current env is merged with `env`. |
| `input` | `string | Uint8Array | Readable` | Write data to stdin. |
| `inputFile` | `string | URL` | Use a file as stdin. |
| `stdin` | stdio option; default `inherit` with `$`, `pipe` otherwise | Can be streams, files, file descriptors, iterables, and more. |
| `stdout` / `stderr` | stdio option; default `pipe` | Can pipe, inherit, ignore, stream, write file, transform, etc. |
| `stdio` | stdio array or shortcut; default `pipe` | Controls all descriptors. |
| `all` | boolean; default `false` | Adds combined/interleaved stdout+stderr. |
| `encoding` | text/binary encoding; default `utf8` | Use `buffer` for binary `Uint8Array`. |
| `lines` | boolean or fd map; default `false` | Return arrays of output lines. |
| `stripFinalNewline` | boolean or fd map; default `true` | Strips final newline, or each line with `lines`. |
| `maxBuffer` | number or fd map; default `100_000_000` | Sets `error.isMaxBuffer` when exceeded. |
| `buffer` | boolean or fd map; default `true` | If false, result output properties are not set. |
| `ipc` | boolean | Enables Execa IPC helpers. |
| `serialization` | `json | advanced`; default `advanced` | IPC serialization kind. |
| `ipcInput` | `Message` | Sends an IPC message when subprocess starts. |
| `verbose` | verbose option; default `none` | Can print command, output, stderr, and IPC messages. |
| `reject` | boolean; default `true` | Reject failed command promises unless false. |
| `timeout` | number; default `0` | Milliseconds before termination; sets `error.timedOut`. |
| `cancelSignal` | `AbortSignal` | Abort to terminate with `SIGTERM`; sets `error.isCanceled`. |
| `gracefulCancel` | boolean; default `false` | For Node subprocesses, lets child handle cancellation via `getCancelSignal()`. |
| `forceKillAfterDelay` | number or boolean; default `5000` | Sends `SIGKILL` if termination does not exit. |
| `killSignal` | signal name or number; default `SIGTERM` | Default signal used for termination. |
| `detached` | boolean; default `false` | Run independently. |
| `cleanup` | boolean; default `true` | Kill subprocess when current process exits. |
| `uid` / `gid` | number | Set subprocess user/group id. |
| `argv0` | string; default file | Set `argv[0]`. |
| `windowsHide` | boolean; default `true` | Do not create a new Windows console window. |
| `windowsVerbatimArguments` | boolean | Default depends on `shell`; affects Windows argument escaping. |

## Best Practices

1. Keep `shell: false` unless shell-specific syntax is required.
2. Use array arguments or template interpolation for user-controlled values.
3. Use `reject: false` when the program has useful non-zero-exit output.
4. Use `timeout` and `cancelSignal` for operations that can hang.
5. Use `maxBuffer`, streaming, or `buffer: false` for commands with large output.
6. Prefer `execaNode()` for Node scripts because it sets `node: true` and inherits Node defaults.
7. Prefer `$` for multi-command scripts; prefer `execa()` in application/library code where explicit options are clearer.
8. Avoid `execaCommand()` except for command strings that really come from a command-line or REPL-like input.

## Common Pitfalls

`stdout`, `stderr`, and `all` can be `undefined` if their streams are only inherited/ignored/writable, or if `buffer` is false.

`all` output requires `all: true`.

`lines: true` changes `stdout`/`stderr` from strings into arrays.

`stripFinalNewline` defaults to true, so preserve exact trailing newlines explicitly when needed.

`shell: true` changes parsing and security properties. Do not combine it with untrusted input.

`execaSync()` returns only a result or throws; it does not return a live subprocess.

`cancelSignal` kills the subprocess by default. `gracefulCancel` is for Node subprocesses that cooperate through Execa IPC.

## Version Notes

Latest npm metadata fetched on 2026-04-27: `execa@9.6.1`.

Package metadata: ESM only (`"type": "module"`), type export `./index.d.ts`, runtime export `./index.js`.

Engine range from npm metadata: `^18.19.0 || >=20.5.0`.
