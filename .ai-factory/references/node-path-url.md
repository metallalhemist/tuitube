# Node Path And URL Reference

> Source: https://nodejs.org/api/path.html
> Source: https://nodejs.org/api/url.html
> Created: 2026-05-01
> Updated: 2026-05-01

## Overview

Node's `node:path` module provides platform-aware path helpers. Node's `node:url` module provides WHATWG URL helpers, including safe conversion of file-system paths to `file:` URLs.

For Tuitube's Telegram delivery work, this reference is most useful for checking actual output file extensions with `path.extname`, avoiding case pitfalls when matching `.mp4`, and converting local file paths to correctly encoded file URLs if Local Bot API path/file-URI upload optimization is added later.

## Core Concepts

`path.extname(path)`: returns the extension from the last `.` in the last path segment through the end. Returns an empty string when there is no extension.

`path.basename(path[, suffix])`: returns the last path portion, optionally removing a matching suffix. Suffix matching is case-sensitive even on Windows.

`path.resolve([...paths])`: resolves segments into an absolute path.

`path.normalize(path)`: normalizes separators and `.`/`..` segments.

`path.win32` and `path.posix`: force Windows or POSIX behavior regardless of host OS.

`pathToFileURL(path)`: converts a path to a `file:` URL and correctly percent-encodes URL control characters. It is safer than constructing `new URL(path, "file:")` manually.

## API / Interface

### `path.extname`

```ts
path.extname(path: string): string;
```

Examples from Node behavior:

| Input | Return |
| --- | --- |
| `index.html` | `.html` |
| `index.coffee.md` | `.md` |
| `index.` | `.` |
| `index` | empty string |
| `.index` | empty string |
| `.index.md` | `.md` |

### `path.basename`

```ts
path.basename(path: string, suffix?: string): string;
```

Suffix matching is case-sensitive. On Windows, `path.win32.basename("C:\\foo.HTML", ".html")` returns `foo.HTML`.

### `pathToFileURL`

```ts
import { pathToFileURL } from "node:url";

pathToFileURL(path: string, options?: { windows?: boolean | undefined }): URL;
```

Node docs state that it resolves the path absolutely and encodes URL control characters.

## Usage Patterns

### Check Actual Download Extension

```ts
import path from "node:path";

function isTelegramVideoCandidate(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".mp4";
}
```

Use the actual downloaded output path, not the requested format alone.

### Build A Safe File URL

```ts
import { pathToFileURL } from "node:url";

const fileUrl = pathToFileURL("/srv/tuitube/downloads/name #1.mp4").href;
```

Do this instead of manual string concatenation so `#`, `%`, spaces, and Windows paths are encoded correctly.

### Preserve File Name For Captions Or Logging

```ts
import path from "node:path";

const fileName = path.basename(result.filePath);
```

Avoid logging full paths if they may contain tenant names, tokens, or other sensitive data.

## Configuration

| Need | API | Notes |
| --- | --- | --- |
| Detect `.mp4` | `path.extname(filePath).toLowerCase()` | Handles uppercase `.MP4`; treats extension only. |
| Avoid basename suffix case surprises | `path.basename(filePath)` without suffix | Case-sensitive suffix removal can surprise on Windows. |
| Generate local file URI | `pathToFileURL(filePath).href` | Correctly encodes URL control characters. |
| Cross-platform tests | `path.win32`, `path.posix` | Useful for deterministic path helper tests. |

## Best Practices

1. Normalize extension comparisons with `.toLowerCase()`.
2. Decide Telegram send behavior from the actual output path after download, because yt-dlp merge/output behavior determines the final file.
3. Use `pathToFileURL` for file URI generation; do not hand-roll `file://` URLs.
4. Avoid using `path.basename(path, suffix)` for case-insensitive logic.
5. Do not log full absolute file paths when they may contain secret-bearing directory names.

## Common Pitfalls

1. Treating `.index` as having extension `.index`; `path.extname(".index")` returns an empty string.
2. Forgetting that `index.` returns `.` as the extension.
3. Comparing extensions without normalizing case.
4. Constructing `file:` URLs manually and failing to encode `#`, `%`, spaces, or Windows drive paths correctly.
5. Assuming a path valid in one Docker container is valid in another; path helpers do not solve container mount visibility.

## Version Notes

The fetched Node docs are for current Node v25.9.0. Tuitube runs on Node 22-compatible TypeScript tooling; `path.extname` and `pathToFileURL` are stable APIs available in supported Node versions.
