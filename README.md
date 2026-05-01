<div align='center'>
    <br/>
    <br/>
    <h3>tuitube</h3>
    <p>TUI to download videos from YouTube, 𝕏, Twitch, Instagram, Bilibili and more using yt-dlp CLI</p>
    <br/>
    <br/>
</div>

![Demo](tuitube-screenshot.png)

## Installation

```sh
curl -sf https://termcast.app/r/tuitube | bash
```

To use this extension, you must have `yt-dlp` and `ffmpeg` installed on your machine.

The easiest way to install this is using [Homebrew](https://brew.sh/). After you have Homebrew installed, run the
following command in your terminal:

```bash
brew install yt-dlp ffmpeg
```

Depending on your macOS version, the package might be located in a different path than the one set by the extension. To
check where `ffmpeg` was installed, run:

```bash
which ffmpeg
```

Then, update the path in the extension preferences to match the output of the above command.

You'll also need `ffprobe`, which is usually installed with `ffmpeg`. Just run `which ffprobe` and update the path
accordingly.

## Windows Beta

**Install yt-dlp**
Use the built-in Windows package manager, `winget`, or alternatives like Scoop or Chocolatey. `yt-dlp` includes `ffmpeg` and `ffprobe` binaries.

```bash
winget install --id=yt-dlp.yt-dlp -e
```

**Update Extension Preferences - Optional**

Extension will detect the paths automatically. But you can Copy the paths from the below commands and set them in the extension's preferences.

After installation, open a new terminal and run the following commands to find the paths for `yt-dlp`, `ffmpeg`, and `ffprobe`:

```powershell
(Get-Command yt-dlp).Source
(Get-Command ffmpeg).Source
(Get-Command ffprobe).Source
```

## Supported Sites

See <https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md>.

## Telegram Backend

Tuitube also includes a Fastify + grammY backend for webhook-based Telegram deployments. It keeps long video work outside the HTTP webhook lifecycle by acknowledging updates quickly and handing metadata preparation, video downloads, and audio extraction to an in-memory worker queue.

The Telegram UX is Russian-language and menu based:

1. A user sends a video URL.
2. The bot replies quickly with `Проверяю ссылку и готовлю варианты...`.
3. A background metadata job fetches `yt-dlp --dump-json` once and prepares the menu options.
4. The bot sends a menu with MP4 video options, `Другие форматы`, `Извлечь аудио`, and `Отмена`.
5. MP4 files are delivered with Telegram `sendVideo` and `supports_streaming: true`; WEBM and other containers are delivered as documents.
6. Menu actions enqueue worker jobs and report the accepted job ID.

### Scripts

```bash
npm run backend:dev
npm run backend:build
npm run backend:start
npm run test:core
```

`backend:dev` runs `src/server/index.ts` with `tsx`. `backend:build` compiles backend-only files with `tsconfig.backend.json`, and `backend:start` runs the compiled `dist/server/index.js`.

### Required Environment

| Variable                  | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | Telegram bot token required for backend startup.                              |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token. Must match `[A-Za-z0-9_-]` and be 1-256 chars. |

### Optional Environment

| Variable                    | Default            | Description                                                                                                  |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `HOST`                      | `0.0.0.0`          | Fastify listen host.                                                                                         |
| `PORT`                      | `3000`             | Fastify listen port.                                                                                         |
| `TELEGRAM_WEBHOOK_URL`      | unset              | Public base URL. When set, startup registers `<base>/telegram/webhook`.                                      |
| `TELEGRAM_API_ROOT`         | Telegram cloud API | Bot API root URL, for example `http://127.0.0.1:18081` for Local Bot API mode. Do not include `/bot<TOKEN>`. |
| `DOWNLOAD_DIR`              | `./downloads`      | Base directory for per-job temporary folders.                                                                |
| `YTDLP_PATH`                | PATH/common lookup | Explicit `yt-dlp` executable path.                                                                           |
| `FFMPEG_PATH`               | PATH/common lookup | Explicit `ffmpeg` executable path.                                                                           |
| `FFPROBE_PATH`              | PATH/common lookup | Explicit `ffprobe` executable path.                                                                          |
| `LOG_LEVEL`                 | `info`             | One of `debug`, `info`, `warn`, `error`, `silent`.                                                           |
| `MAX_CONCURRENT_DOWNLOADS`  | `1`                | Worker concurrency. Keep `1` on small servers.                                                               |
| `MAX_QUEUE_SIZE`            | `5`                | Maximum queued jobs before webhook handlers reject new work.                                                 |
| `MAX_FILE_SIZE_MB`          | `1200`             | Operational server download policy. It does not change Telegram upload limits.                               |
| `MIN_FREE_DISK_MB`          | `6000`             | Minimum free disk to preserve under `DOWNLOAD_DIR`.                                                          |
| `UNKNOWN_SIZE_POLICY`       | `reject`           | Use `allow` to permit downloads when metadata size is unknown.                                               |
| `COMMAND_TIMEOUT_MS`        | `1800000`          | Timeout for external `yt-dlp`/subtitle commands.                                                             |
| `PROCESS_MAX_BUFFER_BYTES`  | `20971520`         | Max buffered process output.                                                                                 |
| `SERVER_REQUEST_TIMEOUT_MS` | `20000`            | Fastify request timeout.                                                                                     |
| `SERVER_BODY_LIMIT_BYTES`   | `1048576`          | Fastify request body limit.                                                                                  |
| `WEBHOOK_TIMEOUT_MS`        | `9000`             | grammY webhook timeout, kept below the server request timeout.                                               |
| `SHUTDOWN_TIMEOUT_MS`       | `15000`            | Graceful worker shutdown window.                                                                             |
| `FORCE_IPV4`                | `false`            | Pass `--force-ipv4` to `yt-dlp`.                                                                             |

### Routes And Smoke Tests

- `GET /healthz` returns `{ ok: true, status: "ok", queueSize }`.
- `POST /telegram/webhook` is mounted through `webhookCallback(bot, "fastify")` and rejects requests without the matching `X-Telegram-Bot-Api-Secret-Token` header.

For a local smoke test, start with a real bot token and no webhook URL:

```bash
TELEGRAM_BOT_TOKEN=123:token TELEGRAM_WEBHOOK_SECRET=dev_secret LOG_LEVEL=debug npm run backend:dev
curl http://localhost:3000/healthz
```

When `TELEGRAM_WEBHOOK_URL` is set, startup registers the Telegram webhook, passes the required `TELEGRAM_WEBHOOK_SECRET` as `secret_token`, and sets `allowed_updates` to `["message", "callback_query"]` so `@grammyjs/menu` callbacks are delivered.

### Local Bot API And Media Delivery

`TELEGRAM_API_ROOT` is the only backend setting for custom Bot API routing. Leave it unset for Telegram cloud mode, or set it to the Local Bot API root URL without `/bot<TOKEN>`:

```bash
TELEGRAM_API_ROOT=http://127.0.0.1:18081
```

Telegram cloud uploads are limited to 50 MB. Local Bot API mode raises the upload limit to 2000 MB. Menu options above the active Telegram upload limit are marked unavailable before a job is queued, and completed files are checked again with `fs.stat` before upload. Files over 50 MB require Local Bot API mode if they should be sent back through Telegram.

`MAX_FILE_SIZE_MB` remains a server download limit for disk and resource control. It is separate from Telegram delivery limits: increasing it lets the worker download larger files, but cloud Telegram still cannot receive files above 50 MB.

The backend currently uses grammY `InputFile` for both cloud and local modes. Local Bot API local-path or `file://` upload can be added later, but only after deployment smoke tests prove the bot process and Bot API server can see the same absolute paths. In Docker, bind the same host download directory into both containers at the same destination path before relying on local-path delivery.

### Deployment And Smoke Tests

When deploying with PM2, target only the Tuitube process and refresh its environment:

```bash
pm2 restart tuitube-bot --update-env
```

Do not use `pm2 restart all` for this project unless you intentionally want to restart unrelated PM2 processes on the host.

Run these smoke tests after changing media delivery settings:

- Send a small MP4 and confirm Telegram receives a playable video.
- In Local Bot API mode, send an MP4 over 50 MB and confirm it is offered and delivered.
- Send a WEBM option and confirm it is delivered as a document, not as a video.
- Use `Извлечь аудио` and confirm M4A/OPUS/MP3 options enqueue and return audio.

For rollback, remove `TELEGRAM_API_ROOT` and restart only `tuitube-bot` with `--update-env`. Follow Telegram Bot API migration handling for the direction you are moving, including `logOut` before redirecting a bot to a Local Bot API server and any required waiting period when returning to the cloud API.

### Operational Notes

Menu sessions are stored in memory for 15 minutes and keyed by Telegram chat id plus the menu message id. Restarting the process clears active menu sessions, so users should resend the URL if an old menu stops working.

The official Telegram cloud Bot API has much smaller upload limits than a Local Telegram Bot API server. Use `TELEGRAM_API_ROOT` for local Bot API mode when large media delivery is required, and validate disk and network behavior before claiming large-file support. Unknown sizes are kept selectable only when server policy allows them, and known upload-limit, server-limit, and disk-limit rejections use distinct menu text.

Downloads use one temporary directory per job under `DOWNLOAD_DIR`. Downloaded media is sent back to the originating Telegram chat before cleanup runs. Transcript results are sent as a normal message when short enough and as a temporary `.txt` document when the transcript is too long; temporary transcript documents are cleaned up after success or failure.

Set `LOG_LEVEL=debug` to inspect verbose menu/session/job diagnostics. Logs intentionally avoid bot tokens, webhook secrets, raw Bot API URLs, raw user URLs, full paths that may contain secrets, file contents, and transcript contents.

Graceful shutdown handles `SIGINT` and `SIGTERM`, closes Fastify, stops accepting jobs, cancels active commands through `AbortSignal`, and runs temporary job cleanup.
