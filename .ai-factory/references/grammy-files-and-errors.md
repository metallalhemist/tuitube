# grammY Files And Errors Reference

> Source: https://grammy.dev/guide/files
> Source: https://grammy.dev/ref/core/inputfile
> Source: https://grammy.dev/ref/core/grammyerror
> Source: https://grammy.dev/ref/core/httperror
> Source: https://grammy.dev/guide/errors
> Created: 2026-05-01
> Updated: 2026-05-01

## Overview

grammY exposes Telegram file sending through the same Bot API methods as Telegram itself. Files can be sent by `file_id`, by public URL, or by uploading file contents with `InputFile`. grammY itself does not impose file-size limits, but Telegram does: cloud Bot API uploads are limited to 50 MB for most files, while supporting larger files requires hosting a local Bot API server.

For Tuitube's Telegram result sender, this reference is most relevant for `InputFile`, `bot.api.sendDocument`, `bot.api.sendVideo`, local-path uploads, and classifying API failures through `GrammyError` and `HttpError`.

## Core Concepts

`InputFile`: grammY wrapper for uploadable file contents. It can wrap local paths, streams, byte arrays, iterables, async iterables, URLs, responses, blobs, and platform-specific file handles.

`file_id`: Telegram-side identifier for a file already known to the bot. Reusing a `file_id` avoids reuploading, but the identifier is bot-specific and file type must match the method used.

Public URL send: pass a public URL string and let Telegram fetch the file. This is simple but has stricter size and MIME-type constraints from Telegram.

Upload send: pass `new InputFile(...)` to any method that accepts file upload. In Node.js, this can be a local path or a `createReadStream`.

Local Bot API file paths: when using a local Bot API server, `getFile.file_path` can be an absolute local path rather than a cloud download path.

`GrammyError`: thrown when grammY successfully contacts the Bot API server, but the server returns `ok: false`.

`HttpError`: thrown when grammY cannot complete the HTTP call to the Bot API server, or an API transformer throws.

## API / Interface

### InputFile

```ts
InputFile(
  file: MaybeSupplier<
    string |
    Blob |
    Deno.FsFile |
    Response |
    URL |
    URLLike |
    Uint8Array |
    ReadableStream<Uint8Array> |
    Iterable<Uint8Array> |
    AsyncIterable<Uint8Array>
  >,
  filename?: string,
);
```

Properties and methods:

| Member | Type | Notes |
| --- | --- | --- |
| `filename` | `readonly filename?: string` | Optional name for the constructed `InputFile`. |
| `toRaw()` | `Promise<Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>>` | Internal method; do not call from app code. |
| `toJSON()` | `void` | Serialization hook. |

### GrammyError

```ts
GrammyError(
  message: string,
  err: ApiError,
  method: string,
  payload: Record<string, unknown>,
);
```

Properties:

| Property | Type | Notes |
| --- | --- | --- |
| `ok` | `false` | Always false. |
| `error_code` | `number` | Telegram error code; subject to change. |
| `description` | `string` | Human-readable Bot API error description. |
| `parameters` | `ResponseParameters` | Optional structured data for automatic handling. |
| `method` | `string` | Bot API method that failed. |
| `payload` | `Record<string, unknown>` | Payload sent to the Bot API method. Treat as sensitive. |

### HttpError

```ts
HttpError(message: string, error: unknown);
```

Properties:

| Property | Type | Notes |
| --- | --- | --- |
| `error` | `unknown` | Underlying fetch/network/transformer failure. |

## Usage Patterns

### Send A Local File With Bot API

```ts
import { InputFile } from "grammy";

await bot.api.sendDocument(chatId, new InputFile("/path/to/file.zip"), {
  caption: "File attached",
});
```

### Send A Streamable Video Upload

```ts
import { InputFile } from "grammy";

await bot.api.sendVideo(chatId, new InputFile("/path/to/video.mp4"), {
  caption: "Ready",
  supports_streaming: true,
});
```

### Send From A Read Stream

```ts
import { createReadStream } from "fs";
import { InputFile } from "grammy";

await bot.api.sendDocument(chatId, new InputFile(createReadStream("/path/to/file.bin")));
```

### Classify Upload Failures

```ts
import { GrammyError, HttpError } from "grammy";

function classifyTelegramSendError(error: unknown): "too_large" | "network" | "telegram" | "unknown" {
  if (error instanceof GrammyError) {
    const description = error.description.toLowerCase();
    if (error.error_code === 413 || description.includes("request entity too large") || description.includes("file is too big")) {
      return "too_large";
    }
    return "telegram";
  }

  if (error instanceof HttpError) return "network";
  return "unknown";
}
```

## Configuration

| Concern | Source behavior | Tuitube implication |
| --- | --- | --- |
| Cloud upload limit | Telegram limits uploads to 50 MB for most bot files. | Reject or disable files above 50 MB unless Local Bot API is configured. |
| Local Bot API large upload | grammY supports Bot API methods needed for a local server; Telegram local server allows up to 2000 MB. | Use `client.apiRoot` in bot config and derive upload policy from `TELEGRAM_API_ROOT`. |
| `InputFile` local path | grammY accepts path strings. | Safe default for uploads is `new InputFile(result.filePath)`. |
| File path from `getFile` | Local Bot API can return an absolute local path. | Do not assume cloud download URL shape in local mode. |

## Best Practices

1. Use `InputFile` for server-local downloaded media unless a trusted `file_id` cache exists.
2. Keep Telegram upload limits separate from application download policy; grammY does not remove Telegram's limits.
3. For `.mp4` outputs meant to play in clients, use `sendVideo` and set `supports_streaming: true` only when the file is expected to be streamable.
4. Use `sendDocument` for non-MPEG4 formats such as WEBM or for unknown media where client video playback is not required.
5. Treat `GrammyError.payload` and method URLs as sensitive because payloads can include chat identifiers, captions, file references, or other user data.
6. Map known too-large descriptions to a user-readable message before rethrowing so job state still records the failure.
7. Keep `HttpError` separate from Bot API response errors; it means the Bot API call could not be completed.

## Common Pitfalls

1. Assuming grammY's lack of file-size limit means Telegram will accept large cloud uploads.
2. Logging `GrammyError.payload` wholesale; payloads may contain sensitive request details.
3. Sending WEBM/VP9/OPUS video through `sendVideo`; Telegram documents MPEG4 support for video clients, while other formats may need `sendDocument`.
4. Passing a URL to Telegram for arbitrary large files; URL sending has stricter Telegram limits than multipart upload.
5. Treating local Bot API paths as visible to every container. A path string is useful only if the process reading it can see the same filesystem path.

## Version Notes

The fetched grammY pages did not expose one global package version banner. Tuitube currently depends on `grammy` `^1.42.0`; refresh this reference before relying on exact type signatures during a package upgrade.
