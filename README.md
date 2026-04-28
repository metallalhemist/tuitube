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

Tuitube also includes a Fastify + grammY backend foundation for webhook-based Telegram deployments. It keeps long video work outside the HTTP webhook lifecycle by acknowledging updates quickly and handing downloads to an in-memory worker queue.

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

| Variable                    | Default            | Description                                                             |
| --------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `HOST`                      | `0.0.0.0`          | Fastify listen host.                                                    |
| `PORT`                      | `3000`             | Fastify listen port.                                                    |
| `TELEGRAM_WEBHOOK_URL`      | unset              | Public base URL. When set, startup registers `<base>/telegram/webhook`. |
| `TELEGRAM_API_ROOT`         | Telegram cloud API | Local Telegram Bot API server root for large-file deployments.          |
| `DOWNLOAD_DIR`              | `./downloads`      | Base directory for per-job temporary folders.                           |
| `YTDLP_PATH`                | PATH/common lookup | Explicit `yt-dlp` executable path.                                      |
| `FFMPEG_PATH`               | PATH/common lookup | Explicit `ffmpeg` executable path.                                      |
| `FFPROBE_PATH`              | PATH/common lookup | Explicit `ffprobe` executable path.                                     |
| `LOG_LEVEL`                 | `info`             | One of `debug`, `info`, `warn`, `error`, `silent`.                      |
| `MAX_CONCURRENT_DOWNLOADS`  | `1`                | Worker concurrency. Keep `1` on small servers.                          |
| `MAX_QUEUE_SIZE`            | `5`                | Maximum queued jobs before webhook handlers reject new work.            |
| `MAX_FILE_SIZE_MB`          | `1200`             | Preflight expected media size limit.                                    |
| `MIN_FREE_DISK_MB`          | `6000`             | Minimum free disk to preserve under `DOWNLOAD_DIR`.                     |
| `UNKNOWN_SIZE_POLICY`       | `reject`           | Use `allow` to permit downloads when metadata size is unknown.          |
| `COMMAND_TIMEOUT_MS`        | `1800000`          | Timeout for external `yt-dlp`/subtitle commands.                        |
| `PROCESS_MAX_BUFFER_BYTES`  | `20971520`         | Max buffered process output.                                            |
| `SERVER_REQUEST_TIMEOUT_MS` | `20000`            | Fastify request timeout.                                                |
| `SERVER_BODY_LIMIT_BYTES`   | `1048576`          | Fastify request body limit.                                             |
| `WEBHOOK_TIMEOUT_MS`        | `9000`             | grammY webhook timeout, kept below the server request timeout.          |
| `SHUTDOWN_TIMEOUT_MS`       | `15000`            | Graceful worker shutdown window.                                        |
| `FORCE_IPV4`                | `false`            | Pass `--force-ipv4` to `yt-dlp`.                                        |

### Routes And Smoke Tests

- `GET /healthz` returns `{ ok: true, status: "ok", queueSize }`.
- `POST /telegram/webhook` is mounted through `webhookCallback(bot, "fastify")` and rejects requests without the matching `X-Telegram-Bot-Api-Secret-Token` header.

For a local smoke test, start with a real bot token and no webhook URL:

```bash
TELEGRAM_BOT_TOKEN=123:token TELEGRAM_WEBHOOK_SECRET=dev_secret LOG_LEVEL=debug npm run backend:dev
curl http://localhost:3000/healthz
```

When `TELEGRAM_WEBHOOK_URL` is set, startup registers the Telegram webhook and passes the required `TELEGRAM_WEBHOOK_SECRET` as `secret_token`.

### Operational Notes

The official Telegram cloud Bot API has much smaller upload limits than a Local Telegram Bot API server. Use `TELEGRAM_API_ROOT` for local Bot API mode when large media delivery is required, and validate disk and network behavior before claiming large-file support.

Downloads use one temporary directory per job under `DOWNLOAD_DIR`. Transcript temporary files are cleaned before returning. Downloaded media is cleaned after the adapter consumes it; the current webhook foundation queues work and leaves the future Telegram delivery adapter as the owner of final send behavior.

Graceful shutdown handles `SIGINT` and `SIGTERM`, closes Fastify, stops accepting jobs, cancels active commands through `AbortSignal`, and runs temporary job cleanup.
