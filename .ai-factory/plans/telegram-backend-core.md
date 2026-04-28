<!-- handoff:task:2944411d-0e32-485f-9243-9855a8189e40 -->

# Implementation Plan: Telegram Backend Core

Branch: feature/telegram-backend-core
Created: 2026-04-27

## Settings

- [ ] Testing: yes
- [ ] Logging: verbose
- [ ] Docs: yes
- [ ] Scope: backend foundation only. Do not add Telegram UI/UX flow, inline keyboards, menus, format-selection conversations, database, Redis, external/persistent queues, persistent `file_id` cache, Docker, CI, or deploy config. A lightweight in-memory job queue boundary is in scope because webhook handlers must not run long downloads inline.

## External API Notes

- [ ] grammY `webhookCallback` accepts a framework adapter and webhook options, including `secretToken`: https://grammy.dev/ref/core/webhookcallback
- [ ] grammY documents `fastify` as a supported webhook adapter and shows `server.post(..., webhookCallback(bot, "fastify"))`: https://grammy.dev/hosting/vps
- [ ] grammY supports a local Telegram Bot API server through `new Bot(token, { client: { apiRoot } })`: https://grammy.dev/guide/api
- [ ] Telegram `setWebhook` accepts `secret_token`; when `TELEGRAM_WEBHOOK_SECRET` is configured, pass the same secret to both `webhookCallback` and `bot.api.setWebhook`.

## Requirements Summary

- [ ] Add a Fastify backend entrypoint with `GET /healthz` and `POST /telegram/webhook`.
- [ ] Add grammY bot construction with optional local Bot API root from `TELEGRAM_API_ROOT`.
- [ ] Read backend env centrally in `src/server/config.ts`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`, optional `TELEGRAM_API_ROOT`, `PORT`, `HOST`, `DOWNLOAD_DIR`, `LOG_LEVEL`, `MAX_CONCURRENT_DOWNLOADS`, `MAX_QUEUE_SIZE`, `MAX_FILE_SIZE_MB`, `MIN_FREE_DISK_MB`, command timeout settings, process `maxBuffer`, force-IPv4 setting, and external binary paths.
- [ ] Read headless executable env/options for `yt-dlp`, `ffmpeg`, and `ffprobe` only in server config, then pass typed options into integrations without importing Termcast preferences or reading `process.env` across feature modules.
- [ ] Add a lightweight backend-safe logger contract so core services can emit structured diagnostics without depending on Fastify, grammY, or Termcast.
- [ ] Keep the Telegram bot handler as a minimal stub that logs or acknowledges update receipt only.
- [ ] When `TELEGRAM_WEBHOOK_URL` is configured, register the Telegram webhook with the configured public URL plus `/telegram/webhook`, including `secret_token` when a webhook secret is configured.
- [ ] Extract reusable video metadata, format choice, download, transcript, and cleanup behavior into backend-friendly core services.
- [ ] Add a lightweight in-memory queue and worker boundary so webhook handling acknowledges quickly and long downloads/transcoding happen outside the HTTP request lifecycle.
- [ ] Enforce small-server operational policy before downloads: queue cap, default single concurrency, expected file-size checks, explicit unknown-size state, and free-disk checks under `DOWNLOAD_DIR`.
- [ ] Add graceful shutdown for the Fastify server, queue worker, active command cancellation, and temporary job cleanup.
- [ ] Keep download/disk policy separate from Telegram delivery limits; cloud Bot API uploads are much smaller than local Bot API server uploads.
- [ ] Preserve the existing Termcast command and AI tool behavior from upstream `remorses/tuitube`, including public tool return shapes, progress toasts, installer/updater flows, URL auto-loading, and final file actions.
- [ ] Document backend env, scripts, healthcheck, webhook route, and local Telegram Bot API usage.
- [ ] Keep TypeScript NodeNext ESM imports explicit with `.js` suffixes.
- [ ] Use external command argument arrays only, with no shell interpolation.
- [ ] Keep temporary files inside per-job directories; clean transcript temp files immediately, and clean downloaded media only after the caller has sent, copied, or otherwise consumed the output path.

## Architecture

- [ ] `src/core/`: backend-safe domain/service layer with errors, pure validation/sanitization/format helpers, temp job lifecycle, and orchestration services.
- [ ] `src/integrations/`: external process adapters for `yt-dlp`, `ffmpeg`, `ffprobe`, and executable lookup. No Termcast imports.
- [ ] `src/adapters/telegram/`: grammY bot factory and minimal update middleware. No conversation or UI flow.
- [ ] `src/server/`: Fastify app factory, env config, routes, webhook wiring, and process entrypoint.
- [ ] `src/core/jobs/`: queue interface, in-memory queue implementation, job worker, and temp job lifecycle. No Redis/BullMQ in this foundation phase.
- [ ] `src/core/policy/`: pure file-size and operational policy helpers that can be tested without external binaries.
- [ ] Existing Termcast files stay in place. `src/utils.ts`, `src/transcript.ts`, `src/tools/*`, and `src/index.tsx` become consumers or compatibility wrappers where practical.

## Commit Plan

- [ ] **Commit 1** (after tasks 1-3): "refactor: add backend-safe core primitives"
- [ ] **Commit 2** (after tasks 4-7): "feat: add reusable video download services"
- [ ] **Commit 3** (after tasks 8-13): "feat: wire telegram webhook backend"
- [ ] **Commit 4** (after task 14): "test: cover backend core helpers"

## Tasks

### Phase 1: Core Foundation

- [x] Task 1: Add backend-safe core errors, types, validation, sanitization, and logger contract.
  - [ ] Deliverable: create `src/core/errors.ts`, `src/core/types.ts`, `src/core/validation.ts`, `src/core/sanitize.ts`, and `src/core/logger.ts`.
  - [ ] Expected behavior: represent missing executable, invalid URL, live stream, and download failure as typed errors or error codes; move URL validation and title sanitization into pure helpers that do not import Termcast; define a minimal logger interface/no-op logger that services can receive by dependency injection.
  - [ ] Files: `src/core/errors.ts`, `src/core/types.ts`, `src/core/validation.ts`, `src/core/sanitize.ts`, `src/core/logger.ts`, `src/utils.ts`.
  - [ ] Logging requirements: do not log inside pure helpers; expose stable error codes/messages so service and server boundaries can log at `WARN` for validation/precondition failures and `ERROR` for unexpected failures; keep the logger contract independent of Fastify, grammY, React, and Termcast.
  - [ ] Dependencies: none.

- [x] Task 2: Extract pure format selection for backend and Termcast reuse.
  - [ ] Deliverable: create `src/core/format-selection.ts` with `getFormats`, `getFormatValue`, `getFormatTitle`, and a backend-oriented `chooseDownloadFormat` helper.
  - [ ] Expected behavior: preserve current Termcast format ordering, keep `MP3_FORMAT_ID`, provide deterministic best video/audio selection for backend downloads, and expose serializable format options with resolution, extension, format id/value, display title, estimated size, disabled state, and machine-readable disabled reason.
  - [ ] Files: `src/core/format-selection.ts`, `src/utils.ts`, `src/types.ts` or `src/core/types.ts`.
  - [ ] Logging requirements: do not log in pure selection logic; download service must log the chosen format id, extension, and reason at `DEBUG`.
  - [ ] Dependencies: task 1.

- [x] Task 3: Add temp job directory lifecycle helpers.
  - [ ] Deliverable: create `src/core/jobs/temp-job.ts` with creation and idempotent cleanup around a per-job directory under a provided base directory.
  - [ ] Expected behavior: use `DOWNLOAD_DIR` or a passed base directory at service boundaries; create a unique job directory with `fs/promises.mkdtemp` under the resolved base directory; reject unsafe base paths and paths that escape the base after resolution; avoid shared temp directories such as the current `.tmp-subtitles`; cleanup recursively and idempotently with `fs/promises.rm({ recursive: true, force: true })` on success and failure.
  - [ ] Files: `src/core/jobs/temp-job.ts`.
  - [ ] Logging requirements: log job directory creation and cleanup at `DEBUG`; log cleanup failures at `WARN` with job id and path, without leaking user tokens or full command output.
  - [ ] Dependencies: task 1.

### Phase 2: External Integrations and Services

- [x] Task 4: Add headless executable lookup and process execution adapters.
  - [ ] Deliverable: create `src/integrations/executables.ts` and `src/integrations/process.ts`.
  - [ ] Expected behavior: resolve `yt-dlp`, `ffmpeg`, and `ffprobe` from explicit typed service options supplied by `src/server/config.ts` or Termcast wrappers, plus PATH/common-path fallback inside the lookup adapter; backend env such as `YTDLP_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH` must be parsed in config only; validate existence; run commands with argument arrays only and `shell: false`; support timeout and cancellation through execa `timeout` and `cancelSignal`; set `maxBuffer` and `windowsHide`; support both buffered command execution and streaming line/progress callbacks so Termcast progress toasts can be preserved without importing Termcast; map `ExecaError` fields such as `timedOut`, `isCanceled`, `isMaxBuffer`, `exitCode`, and `code` into typed failures; return bounded stdout/stderr excerpts in typed failures; do not import Termcast preferences from `src/utils.ts` and do not read `process.env` in integration modules.
  - [ ] Files: `src/integrations/executables.ts`, `src/integrations/process.ts`, `src/core/errors.ts`.
  - [ ] Logging requirements: log resolved executable names and whether lookup came from options/env/PATH at `DEBUG`; log missing executable as `ERROR` with the executable name, not raw PATH dumps.
  - [ ] Dependencies: task 1.

- [x] Task 5: Add `yt-dlp` and subtitle integration adapters.
  - [ ] Deliverable: create `src/integrations/yt-dlp.ts` with metadata fetch, video download, subtitle download/conversion, and stdout filepath extraction helpers.
  - [ ] Expected behavior: call `yt-dlp` with arrays through the process adapter, support `--force-ipv4` through typed service options, pass `--ffmpeg-location`, use `--ignore-config` by default for backend/headless metadata, download, and subtitle commands unless an explicit config path is intentionally added later, use `--no-playlist`, `--dump-json`, `--format-sort=resolution,ext,tbr`, `--print after_move:filepath`, output templates inside the job directory, insert `--` before each untrusted URL argument, apply configured command timeouts/cancellation, and parse printed output paths on both POSIX and Windows. Subtitle commands must use canonical flags `--write-subs`, `--write-auto-subs`, `--sub-langs`, `--sub-format vtt/srt/best`, and `--convert-subs srt`.
  - [ ] Files: `src/integrations/yt-dlp.ts`, `src/integrations/executables.ts`, `src/core/errors.ts`.
  - [ ] Logging requirements: log command phase and sanitized argument summary at `DEBUG`; log `yt-dlp` non-zero failures at `ERROR` with stderr excerpt and mapped `DOWNLOAD_FAILED` code.
  - [ ] Dependencies: tasks 2, 3, 4.

- [x] Task 6: Add backend operational policy and preflight checks.
  - [ ] Deliverable: create `src/core/policy/download-policy.ts` and `src/integrations/filesystem.ts`.
  - [ ] Expected behavior: represent configured defaults for `MAX_FILE_SIZE_MB=1200`, `MIN_FREE_DISK_MB=6000`, and unknown-size handling; compute expected media size from exact or approximate format sizes, including best-audio pairing for video-only formats when known; expose disabled states and machine-readable reasons such as `too_large`, `insufficient_disk`, and `unknown_size`; attach policy state to serializable format options from task 2; check free disk space under `DOWNLOAD_DIR` before starting a download; keep env parsing outside core policy; keep this download/disk policy distinct from Telegram delivery/upload limits so cloud Bot API and local Bot API server modes can apply different send constraints later.
  - [ ] Files: `src/core/policy/download-policy.ts`, `src/integrations/filesystem.ts`, `src/core/types.ts`, `src/core/errors.ts`.
  - [ ] Logging requirements: log preflight decisions at `DEBUG`; log rejected downloads at `WARN` with reason codes, not raw URLs or sensitive env values.
  - [ ] Dependencies: tasks 1-5.

- [x] Task 7: Implement reusable download and transcript services.
  - [ ] Deliverable: create `src/core/services/video-download-service.ts`, `src/core/services/transcript-service.ts`, and `src/core/transcript/clean-srt.ts`.
  - [ ] Expected behavior: expose service methods for metadata lookup, format choice, preflight policy evaluation, video download to a temp job directory, transcript extraction, optional progress/line callbacks for callers that need UI progress, and cleanup; reject live streams; return serializable metadata, policy states, and output paths for callers; define ownership clearly so transcript temp files are deleted before returning but downloaded media remains available until an adapter completes send/copy/export and then calls cleanup.
  - [ ] Files: `src/core/services/video-download-service.ts`, `src/core/services/transcript-service.ts`, `src/core/transcript/clean-srt.ts`, `src/transcript.ts`.
  - [ ] Logging requirements: log service entry, metadata retrieval, live-stream rejection, selected format, download start/finish, transcript language, and cleanup outcome at `DEBUG`/`INFO`; log known typed errors at `WARN` or `ERROR` according to severity.
  - [ ] Dependencies: tasks 1-6.

### Phase 3: Compatibility and Backend Wiring

- [x] Task 8: Add in-memory job queue and worker boundary.
  - [ ] Deliverable: create `src/core/jobs/queue.ts`, `src/core/jobs/in-memory-queue.ts`, `src/core/jobs/job-service.ts`, and `src/core/jobs/download-worker.ts`.
  - [ ] Expected behavior: define a replaceable `JobQueue` interface, implement a small in-memory queue with default `MAX_QUEUE_SIZE=5`, run downloads with default `MAX_CONCURRENT_DOWNLOADS=1`, expose queued/running/completed/failed/cancelled states, and keep long-running downloads/transcoding outside the Fastify webhook request lifecycle. Do not add Redis, BullMQ, database storage, or persistent job state.
  - [ ] Files: `src/core/jobs/queue.ts`, `src/core/jobs/in-memory-queue.ts`, `src/core/jobs/job-service.ts`, `src/core/jobs/download-worker.ts`, `src/core/types.ts`, `src/core/errors.ts`.
  - [ ] Logging requirements: log enqueue/dequeue/start/finish/failure/cancellation at `INFO` or `DEBUG`; log queue capacity rejection at `WARN`; never log bot tokens, webhook secrets, or full webhook URLs.
  - [ ] Dependencies: tasks 1, 3, 6, and 7.

- [x] Task 9: Preserve Termcast command and tool behavior through compatibility wrappers.
  - [ ] Deliverable: refactor existing Termcast-facing modules to import backend-safe core helpers where possible while preserving existing exports and UI behavior.
  - [ ] Expected behavior: `src/index.tsx` still loads metadata, shows formats, downloads with streaming progress toasts, shows installer/updater views, supports clipboard/selected-text/browser-extension URL auto-loading, and preserves final file actions such as open folder and copy file to clipboard. `src/tools/download-video.ts` must preserve the public return shape `{ downloadedPath, fileName, title, duration }`; `src/tools/extract-transcript.ts` must keep returning a plain transcript string. The Termcast UI download path may stay on the existing streaming adapter until the core process adapter fully supports progress callbacks.
  - [ ] Files: `src/utils.ts`, `src/transcript.ts`, `src/tools/download-video.ts`, `src/tools/extract-transcript.ts`, `src/index.tsx`.
  - [ ] Logging requirements: keep Termcast expected failures user-facing through toasts or thrown tool errors; avoid routine `console.log` in UI; log only diagnostic failures that are not already surfaced to the user.
  - [ ] Dependencies: task 7.

- [x] Task 10: Add backend package dependencies, scripts, and build config.
  - [ ] Deliverable: update package metadata for `grammy`, `fastify`, backend TypeScript execution/build, and minimal test execution.
  - [ ] Expected behavior: keep `npm run build` for Termcast intact; add scripts such as `backend:dev`, `backend:build`, `backend:start`, and `test:core`; choose a concrete minimal test runner for TypeScript ESM tests (prefer `vitest` unless implementation findings justify another runner); add a backend tsconfig if needed so backend compilation does not require Termcast UI files; keep upstream lockfile policy by updating both `package-lock.json` and `bun.lock` whenever package metadata changes. Do not remove either lockfile unless a separate explicit cleanup task is created outside this backend-foundation scope.
  - [ ] Files: `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.backend.json` or equivalent.
  - [ ] Logging requirements: scripts must preserve runtime log controls through env such as `LOG_LEVEL`; backend dev script should not hide server startup errors.
  - [ ] Dependencies: task 7.

- [x] Task 11: Add Fastify server and grammY bot wiring.
  - [ ] Deliverable: create `src/server/config.ts`, `src/server/app.ts`, `src/server/index.ts`, and `src/adapters/telegram/bot.ts`.
  - [ ] Expected behavior: parse env centrally, require `TELEGRAM_BOT_TOKEN` for backend start, validate `TELEGRAM_WEBHOOK_SECRET` against Telegram's 1-256 character `[A-Za-z0-9_-]` rule, parse numeric env values with explicit bounds/defaults, safely join `TELEGRAM_WEBHOOK_URL` with `/telegram/webhook`, create `Bot` with optional `client.apiRoot`, register a minimal update handler that enqueues or acknowledges work instead of downloading inline, expose `GET /healthz`, mount `POST /telegram/webhook` via `webhookCallback(bot, "fastify", { secretToken, timeoutMilliseconds, onTimeout })` with a grammY timeout shorter than Fastify's request timeout, configure Fastify `requestTimeout` and `bodyLimit`, add structured bot error handling such as `bot.catch`, and call `bot.api.setWebhook()` with the final webhook URL and matching `secret_token` when a webhook URL and secret are configured. Keep `src/server/app.ts` as a side-effect-light app factory for `fastify.inject()` tests: it must not call `listen()` or `bot.api.setWebhook()`; `src/server/index.ts` owns startup, listening, and webhook registration side effects.
  - [ ] Files: `src/server/config.ts`, `src/server/app.ts`, `src/server/index.ts`, `src/adapters/telegram/bot.ts`.
  - [ ] Logging requirements: log server startup host/port, webhook path, local API root enabled/disabled, update id/type receipt at `INFO` or `DEBUG`, webhook registration result at `INFO`, and bot/server errors at `ERROR`.
  - [ ] Dependencies: tasks 7, 8, and 10.

- [x] Task 12: Add backend lifecycle and graceful shutdown handling.
  - [ ] Deliverable: add startup/shutdown lifecycle helpers in `src/server/index.ts` or `src/server/lifecycle.ts`, plus worker stop/cancellation hooks where the queue worker is composed.
  - [ ] Expected behavior: handle `SIGINT` and `SIGTERM`; call `fastify.close()`; also register shared cleanup through Fastify lifecycle hooks such as `onClose` so programmatic close and tests stop workers; stop accepting new jobs; drain or cancel the in-memory worker according to configured shutdown timeout; propagate cancellation to active external commands through `AbortSignal`; run temporary job cleanup in `finally`; avoid calling `bot.start()` in webhook mode; avoid deleting or changing the Telegram webhook as part of normal process shutdown unless explicitly configured later.
  - [ ] Files: `src/server/index.ts`, `src/server/lifecycle.ts` if useful, `src/core/jobs/job-service.ts`, `src/core/jobs/download-worker.ts`, `src/integrations/process.ts`.
  - [ ] Logging requirements: log signal receipt, shutdown start/finish, worker drain/cancel outcome, and cleanup failures; do not log bot tokens, webhook secrets, raw secret-bearing webhook URLs, full PATH dumps, or unbounded command output.
  - [ ] Dependencies: tasks 8, 10, and 11.

- [x] Task 13: Document backend usage and operational assumptions.
  - [ ] Deliverable: update `README.md` with backend setup and smoke-test notes.
  - [ ] Expected behavior: document required and optional backend env vars, `backend:*` scripts, `GET /healthz`, `POST /telegram/webhook`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_API_ROOT`, `DOWNLOAD_DIR`, external binary env/options, command timeout settings, queue limits, file-size/disk limits, Telegram cloud vs local Bot API upload constraints, graceful shutdown behavior, and the rule that downloaded media is cleaned after the adapter consumes it.
  - [ ] Files: `README.md`.
  - [ ] Logging requirements: document `LOG_LEVEL` behavior without adding verbose runtime output to Termcast flows.
  - [ ] Dependencies: tasks 4, 6, 7, 8, 10, 11, and 12.

### Phase 4: Verification

- [x] Task 14: Add focused tests for pure helpers, temp job lifecycle, policy, queue behavior, and lifecycle behavior.
  - [ ] Deliverable: add tests for URL validation, title sanitization, temp job creation/cleanup, format choice and serializable format option policy state, operational policy decisions, SRT cleanup, stdout filepath parsing, process timeout/error mapping, env/config validation, webhook URL assembly, side-effect-light Fastify app factory behavior with `fastify.inject()`, grammY webhook timeout/error configuration, Termcast tool wrapper return-shape compatibility, in-memory queue capacity/concurrency behavior, worker cancellation, and shutdown cleanup.
  - [ ] Expected behavior: tests run without `yt-dlp`, `ffmpeg`, Telegram token, network, Termcast runtime, or real downloads; temp test files are cleaned up after each test.
  - [ ] Files: `src/core/**/*.test.ts` or `tests/core/*.test.ts`, plus package script updates from task 10.
  - [ ] Logging requirements: tests should assert helper behavior rather than snapshot logs; when testing cleanup failure paths, capture or stub logger output to verify `WARN` without noisy console output.
  - [ ] Dependencies: tasks 1-12.

## Quality Gates

- [ ] `npm run build` keeps the current Termcast package build working.
- [x] `npm run backend:build` compiles the Fastify/grammY backend entrypoint.
- [x] `npm run test:core` runs without external binaries or Telegram credentials.
- [ ] Manual smoke test: start backend with fake/non-production env except token where needed, confirm `GET /healthz` returns ok and `POST /telegram/webhook` reaches the grammY callback.
- [x] Webhook check: verify Telegram updates are acknowledged quickly and no download, ffmpeg conversion, ffprobe call, or Telegram upload runs inside the Fastify request lifecycle.
- [x] Policy check: verify queue cap, default single concurrency, expected file-size rejection, unknown-size state, free-disk preflight, and cleanup behavior under `DOWNLOAD_DIR`.
- [ ] Lifecycle check: verify `SIGINT`/`SIGTERM` close Fastify, stop or cancel the worker, propagate cancellation to active commands, and clean temporary job directories.
- [x] Static check: verify all external command invocations pass argument arrays and no shell-interpolated user input is introduced.
- [x] Boundary check: verify `src/core` imports no Termcast, React, grammY, Fastify, or `@grammyjs/menu`; verify only `src/server/config.ts` reads backend `process.env`; verify command integrations receive typed config/options rather than reading env directly.
- [x] Secret check: verify logs and errors do not include bot tokens, webhook secrets, raw secret-bearing webhook URLs, full PATH dumps, or unbounded command output.
- [x] Docs check: README documents backend env vars, scripts, webhook route, healthcheck, local Telegram Bot API configuration, Telegram cloud/local upload limits, queue limits, file-size/disk limits, graceful shutdown, and cleanup ownership.

## Rework 2026-04-28

- [x] `fbc47e0060e4`: Termcast AI download tool constructs `VideoDownloadService` with an explicit compatibility policy that allows unknown sizes and skips backend free-disk reserve enforcement.
- [x] `4bcbb406b6a8`: Telegram text handler catches `QUEUE_FULL` and other enqueue failures and replies immediately.
- [x] `73eb850994c9`: Download worker clears and unreferences the shutdown timeout so it remains a maximum deadline.
- [x] `63889b7e55ae`: Backend config requires `TELEGRAM_WEBHOOK_SECRET`, and the webhook route rejects missing or invalid secret headers.
- [x] `c979fe9171b9`: URL validation now requires public `http`/`https` URLs and rejects loopback, private, link-local, and local/internal hostnames before `yt-dlp`.
- [x] `98b58fe1f573`: `yt-dlp` integration calls now run through a local HTTP/CONNECT egress proxy that blocks private, loopback, link-local, and reserved DNS/IP targets on each connection.
- [x] `0d249d4aa527`: External command stdout/stderr excerpts are redacted for URLs and token-like values before logging or storing process failures.
- [x] `dfebde39bb9f`: Process failures no longer attach the raw `execa` error as `Error.cause`.
- [x] `0948adff360b`: External command execution now uses an allowlisted subprocess environment with `extendEnv: false`.
