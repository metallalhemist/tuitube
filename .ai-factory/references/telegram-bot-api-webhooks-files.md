# Telegram Bot API Webhooks And Files Reference

> Source:
> - https://core.telegram.org/bots/api#setwebhook
> - https://core.telegram.org/bots/api#using-a-local-bot-api-server
> - https://core.telegram.org/bots/api#sending-files
> - https://core.telegram.org/bots/api#inputfile
> - https://core.telegram.org/bots/api#getfile
> - https://core.telegram.org/bots/api#senddocument
> - https://core.telegram.org/bots/api#sendvideo
> - https://core.telegram.org/bots/features#local-bot-api
> - https://core.telegram.org/bots/self-signed
> - https://github.com/tdlib/telegram-bot-api
> Created: 2026-04-27
> Updated: 2026-05-01

## Overview

Telegram Bot API is an HTTP API for bots. Cloud API requests use `https://api.telegram.org/bot<token>/METHOD_NAME`; the API supports GET and POST, and parameters can be sent as query string, `application/x-www-form-urlencoded`, `application/json` except when uploading files, or `multipart/form-data` for uploads.

Updates are received by either `getUpdates` long polling or webhook delivery; these modes are mutually exclusive. `setWebhook` configures Telegram to send HTTPS POST requests containing JSON-serialized `Update` objects. If a webhook response is not successful, Telegram retries and later gives up after a reasonable number of attempts.

The local Bot API server can replace `https://api.telegram.org` for bots that need larger uploads, local file paths, HTTP/local webhooks, higher webhook connection limits, or unlimited file downloads. The official local server source is `tdlib/telegram-bot-api`.

## Core Concepts

`Update`: Incoming event object delivered by long polling or webhook. `update_id` can be used to ignore repeated updates or restore order if webhook deliveries arrive out of order.

`InputFile`: Represents uploaded file contents. It must be posted with `multipart/form-data`.

`file_id`: Telegram-side file identifier. It is unique per bot and can be reused by the same bot to send a file again without reuploading.

`file_unique_id`: Stable unique file identifier across bots, but it cannot be used to download or reuse a file.

`file_path`: Path returned by `getFile` for downloading a file. With the cloud API, download from `https://api.telegram.org/file/bot<token>/<file_path>`.

`attach://<file_attach_name>`: Multipart reference syntax for fields that need to point at another file part in the same request, such as thumbnails or covers.

`secret_token`: Optional webhook secret sent by Telegram in the `X-Telegram-Bot-Api-Secret-Token` header. Allowed characters are `A-Z`, `a-z`, `0-9`, `_`, and `-`; length is 1-256 characters.

## API / Interface

### Request And Response Format

| Item | Source-defined behavior |
| --- | --- |
| Base cloud method URL | `https://api.telegram.org/bot<token>/METHOD_NAME` |
| Supported HTTP methods | GET and POST |
| Parameter formats | URL query string, `application/x-www-form-urlencoded`, `application/json` except uploads, `multipart/form-data` for uploads |
| Encoding | UTF-8 |
| Success response | JSON object with `ok: true` and `result` |
| Error response | JSON object with `ok: false`, `description`, and `error_code`; may include `parameters` |
| Method names | Case-insensitive |

When answering a webhook request, a bot can call a Bot API method in the HTTP response by using `application/json`, `application/x-www-form-urlencoded`, or `multipart/form-data` and including the method name in the `method` parameter. Telegram does not expose the result of that chained method call to the bot.

### setWebhook

Purpose: Configure a URL for incoming updates. On success, returns `True`.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | `String` | Yes | HTTPS URL for updates. Empty string removes webhook integration. |
| `certificate` | `InputFile` | Optional | Public key certificate for certificate checks. For self-signed certificates, upload as multipart `InputFile`; a string is not accepted. |
| `ip_address` | `String` | Optional | Fixed IP address Telegram should use instead of DNS resolution. |
| `max_connections` | `Integer` | Optional | Simultaneous HTTPS connections for delivery, `1-100`, default `40`. Local server mode allows up to `100000`. |
| `allowed_updates` | `Array of String` | Optional | JSON-serialized update type list. Empty list receives all update types except `chat_member`, `message_reaction`, and `message_reaction_count`. If omitted, previous setting is reused. |
| `drop_pending_updates` | `Boolean` | Optional | Drops all pending updates. |
| `secret_token` | `String` | Optional | Sent in `X-Telegram-Bot-Api-Secret-Token`; 1-256 allowed characters from `A-Z`, `a-z`, `0-9`, `_`, `-`. |

Webhook notes:

1. While an outgoing webhook is set, `getUpdates` cannot be used.
2. Supported cloud webhook ports are `443`, `80`, `88`, and `8443`.
3. `allowed_updates` does not affect updates created before the `setWebhook` call, so unwanted updates can still arrive briefly.
4. `secret_token` is the documented way to verify that a webhook request came from a webhook configured by the bot owner.

### deleteWebhook

Purpose: Remove webhook integration to switch back to `getUpdates`. On success, returns `True`.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `drop_pending_updates` | `Boolean` | Optional | Drops all pending updates. |

### getWebhookInfo

Purpose: Get current webhook status. Takes no parameters. On success, returns `WebhookInfo`. If using `getUpdates`, the returned `url` field is empty.

Important `WebhookInfo` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `url` | `String` | Webhook URL, possibly empty. |
| `has_custom_certificate` | `Boolean` | True when a custom certificate was provided. |
| `pending_update_count` | `Integer` | Updates awaiting delivery. |
| `ip_address` | `String` | Optional currently used webhook IP address. |
| `last_error_date` | `Integer` | Optional Unix time for most recent delivery error. |
| `last_error_message` | `String` | Optional human-readable delivery error. |
| `last_synchronization_error_date` | `Integer` | Optional most recent Telegram datacenter synchronization error time. |
| `max_connections` | `Integer` | Optional maximum allowed HTTPS connections. |
| `allowed_updates` | `Array of String` | Optional subscribed update types. Defaults to all except `chat_member`. |

### logOut

Purpose: Log the bot out from the cloud Bot API server before running it locally. Required before local launch if update delivery correctness matters. After a successful call, the bot can immediately log in on a local server, but cannot log back in to the cloud server for 10 minutes.

### close

Purpose: Close a bot instance before moving it from one local server to another. The webhook should be deleted before calling this method so the instance is not launched again after restart. The method returns error `429` during the first 10 minutes after the bot is launched.

### sendDocument

Purpose: Send general files. On success, returns `Message`. Cloud bots can currently send files of any type up to `50 MB`; this limit may change.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `chat_id` | `Integer or String` | Yes | Target chat ID or `@channelusername`. |
| `document` | `InputFile or String` | Yes | `file_id`, HTTP URL, or multipart upload. |
| `thumbnail` | `InputFile or String` | Optional | JPEG, less than `200 kB`, width/height at most `320`; ignored unless the document is multipart uploaded. Thumbnails cannot be reused and must be uploaded as a new file, or referenced by `attach://...`. |
| `caption` | `String` | Optional | 0-1024 characters after entity parsing. |
| `parse_mode` | `String` | Optional | Formatting mode for caption. |
| `caption_entities` | `Array of MessageEntity` | Optional | JSON-serialized caption entities instead of `parse_mode`. |
| `disable_content_type_detection` | `Boolean` | Optional | Applies to multipart uploads. |

Common optional message parameters include `business_connection_id`, `message_thread_id`, `direct_messages_topic_id`, `disable_notification`, `protect_content`, `allow_paid_broadcast`, `message_effect_id`, `suggested_post_parameters`, `reply_parameters`, and `reply_markup`.

### sendVideo

Purpose: Send MPEG4 video files; other formats may be sent as documents. On success, returns `Message`. Cloud bots can currently send video files up to `50 MB`; this limit may change.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `chat_id` | `Integer or String` | Yes | Target chat ID or `@channelusername`. |
| `video` | `InputFile or String` | Yes | `file_id`, HTTP URL, or multipart upload. |
| `duration` | `Integer` | Optional | Duration in seconds. |
| `width` | `Integer` | Optional | Video width. |
| `height` | `Integer` | Optional | Video height. |
| `thumbnail` | `InputFile or String` | Optional | JPEG, less than `200 kB`, width/height at most `320`; ignored unless multipart uploaded. Use `attach://...` when uploaded in the same request. |
| `cover` | `InputFile or String` | Optional | `file_id`, HTTP URL, or `attach://...` multipart reference. |
| `start_timestamp` | `Integer` | Optional | Start timestamp for the video in the message. |
| `caption` | `String` | Optional | 0-1024 characters after entity parsing. |
| `supports_streaming` | `Boolean` | Optional | Pass true if the uploaded video is suitable for streaming. |

### getFile

Purpose: Get basic file information and prepare a file for download. On success, returns `File`.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_id` | `String` | Yes | File identifier to inspect/download. |

Cloud `getFile` constraints:

1. Bots can download files up to `20 MB`.
2. The returned download URL is valid for at least 1 hour.
3. A fresh link can be requested by calling `getFile` again.
4. The method may not preserve original filename or MIME type, so save them when the `File` object is received.

## Sending Files

Telegram documents three file-sending modes:

| Mode | How to pass the file | Limits and notes |
| --- | --- | --- |
| Reuse existing Telegram file | Pass `file_id` as the method file parameter. | No limits for files sent this way. File type cannot be changed when reusing by `file_id`; thumbnails cannot be resent; `file_id` is bot-specific and can change for the same file. |
| Let Telegram fetch URL | Pass HTTP URL as a string. | Max `5 MB` for photos and `20 MB` for other content. URL target must have the correct MIME type. `sendDocument` by URL currently works only for `.PDF` and `.ZIP`. `sendVoice` URL files must be `audio/ogg` and not more than `1 MB`; larger 1-20 MB voice notes are sent as files. |
| Upload file contents | Use `multipart/form-data` with `InputFile`. | Max `10 MB` for photos and `50 MB` for other files on the cloud API. Local server mode allows uploads up to `2000 MB`. |

## Local Bot API Server

The local Bot API server lets a bot send Bot API requests to a self-hosted server instead of `https://api.telegram.org`.

The Telegram Bot Features page summarizes the deployment limits as:

| API mode | Max file download | Max file upload | Webhook URL | Webhook port | Webhook max connections |
| --- | --- | --- | --- | --- | --- |
| Official | `20 MB` | `50 MB` | HTTPS | `443`, `80`, `88`, `8443` | `1-100` |
| Local | Unlimited | `2000 MB` | HTTP | Any port | `1-100000` |

The same page says to use `logOut` before redirecting requests to a new local API URL and notes that local Bot API accepts HTTP requests only.

Source-documented local server capabilities:

1. Download files without a size limit.
2. Upload files up to `2000 MB`.
3. Upload files using local paths and the file URI scheme.
4. Use HTTP URLs for webhooks.
5. Use any local IP address for webhooks.
6. Use any port for webhooks.
7. Set `max_webhook_connections` up to `100000`.
8. Receive absolute local paths in `file_path` without a follow-up file download after `getFile`.

Official local server repository notes:

| Topic | Source-defined detail |
| --- | --- |
| Source | `https://github.com/tdlib/telegram-bot-api` |
| Mandatory options | `--api-id` and `--api-hash`, or `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` environment variables |
| Enable local-only features | Start with `--local` |
| Default port | `8081` |
| Port override | `--http-port` |
| Transport | The local server accepts HTTP requests; use a TLS termination proxy for remote HTTPS requests |
| Dependencies | OpenSSL, zlib, C++17 compiler for build, gperf for build, CMake 3.10+ for build |

Moving from cloud API to a local server:

1. Call `logOut` on the cloud Bot API server.
2. Send future Bot API requests to the local server.
3. If launched with `--local`, ensure code can handle absolute file paths returned in `getFile.file_path`.

Moving from one local server to another:

1. Call `logOut` on the old server before switching.
2. To avoid losing updates between shutdown and startup, call `deleteWebhook`, then `close`.
3. Move the bot subdirectory in the old server working directory to the new server working directory, then use the new server.

## Self-Signed Certificates

For self-signed webhook certificates:

1. Upload the certificate through `setWebhook.certificate`.
2. The certificate must be PEM encoded.
3. The PEM file should contain only the public key, including BEGIN and END portions.
4. If converting from a bundle format, split the file so only the public key is uploaded.

Source OpenSSL generation command:

```bash
openssl req -newkey rsa:2048 -sha256 -nodes -keyout YOURPRIVATE.key -x509 -days 365 -out YOURPUBLIC.pem -subj "/C=US/ST=New York/L=Brooklyn/O=Example Brooklyn Company/CN=YOURDOMAIN.EXAMPLE"
```

Source inspection command:

```bash
openssl x509 -text -noout -in YOURPUBLIC.pem
```

Source conversion commands:

```bash
openssl x509 -inform der -in YOURDER.der -out YOURPEM.pem
openssl pkcs12 -in YOURPKCS.p12 -out YOURPEM.pem
```

## Usage Patterns

### Set A Webhook With A Secret Token

Derived from the documented request shape and `setWebhook` parameters:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/telegram/webhook",
    "secret_token": "change_me_32_chars",
    "drop_pending_updates": true,
    "allowed_updates": ["message", "callback_query"]
  }'
```

Webhook handler check derived from `secret_token` behavior:

```ts
const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
const actual = request.headers.get("x-telegram-bot-api-secret-token");

if (!expected || actual !== expected) {
  return new Response("Unauthorized", { status: 401 });
}
```

### Upload A File With multipart/form-data

Derived from the documented `InputFile` and request format:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" \
  -F "chat_id=${CHAT_ID}" \
  -F "document=@/path/to/file.zip" \
  -F "caption=File attached"
```

### Send A Video As A Streamable Upload

Derived from `sendVideo` parameters:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendVideo" \
  -F "chat_id=${CHAT_ID}" \
  -F "video=@/path/to/video.mp4" \
  -F "supports_streaming=true"
```

### Download A File From The Cloud API

Derived from `getFile` and `File.file_path`:

```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${FILE_ID}"
curl -L "https://api.telegram.org/file/bot${BOT_TOKEN}/${FILE_PATH}" -o output.bin
```

## Configuration

| Need | Cloud API | Local Bot API server with `--local` |
| --- | --- | --- |
| Method endpoint | `https://api.telegram.org/bot<token>/METHOD_NAME` | Local server base URL in the same Bot API method shape |
| Upload files | `10 MB` photos, `50 MB` other multipart files | Up to `2000 MB` |
| Download files | Up to `20 MB` via `getFile` download URL | No size limit; `file_path` may be absolute local path |
| Webhook URL scheme | HTTPS | HTTP URL allowed |
| Webhook ports | `443`, `80`, `88`, `8443` | Any port |
| Webhook IP | Fixed public IP optional | Any local IP allowed |
| `max_webhook_connections` | `1-100`, default `40` | Up to `100000` |

## Best Practices

1. Use one update mode at a time: `setWebhook` disables `getUpdates`, and `getUpdates` does not work while a webhook is active.
2. Use `secret_token` and verify `X-Telegram-Bot-Api-Secret-Token` in webhook handlers.
3. Use `file_id` for repeated sends when possible; Telegram documents it as the recommended path for already stored files.
4. Use `sendDocument` for non-MPEG4 videos or when video client playback is not required, because `sendVideo` is for MPEG4 videos and other formats may be documents.
5. Save original filename and MIME type when first receiving a `File` object, because `getFile` may not preserve them.
6. Use a local Bot API server when cloud file limits or webhook restrictions block the required workflow.
7. When moving to a local server, call `logOut` first to preserve update delivery correctness.
8. When moving between local servers, use `deleteWebhook` and `close` before moving the bot working directory if update loss must be avoided.

## Common Pitfalls

1. Sending a self-signed certificate path or string in `certificate`; Telegram requires uploading the public certificate as multipart `InputFile`.
2. Expecting `allowed_updates` to filter already-created updates immediately; old updates can still arrive briefly.
3. Sending documents by URL for arbitrary file types; Telegram currently documents URL-based `sendDocument` support only for `.PDF` and `.ZIP`.
4. Reusing a `file_id` across bots; `file_id` is unique per bot.
5. Trying to resend thumbnails by `file_id`; thumbnails cannot be resent and must be newly uploaded where required.
6. Assuming cloud `getFile` can download large files; cloud download limit is `20 MB`.
7. Running a bot on cloud and local servers at the same time; the local server README says update delivery is not guaranteed in that case.
8. Forgetting that a local Bot API server accepts HTTP requests only; remote HTTPS exposure requires TLS termination outside the server.

## Version Notes

The fetched Bot API page lists `Bot API 9.6` under recent changes dated `April 3, 2026`. This reference was created on `2026-04-27` from the Telegram documentation available at that time.
