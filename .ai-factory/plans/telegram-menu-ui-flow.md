# Implementation Plan: Telegram Menu UI Flow

Branch: feature/telegram-menu-ui-flow
Created: 2026-04-29
Handoff Task: 1b2eb054-78b3-4cf7-b792-3ecb1cf94ca1

## Settings

- [ ] Testing: yes
- [ ] Logging: verbose
- [ ] Docs: yes
- [ ] Scope: add the first menu-based Telegram UI flow for URL intake, metadata/options preparation, video download, quality selection, MP3 extraction, transcript extraction, and cancellation. Keep core services UI-agnostic and keep all user-facing Telegram copy in Russian.

## Research Context

Source: .ai-factory/RESEARCH.md (Active Summary)

Topic: Telegram bot UI flow for video download, MP3 extraction, transcript extraction, and cancellation.

Goal:

- Add a menu-based Telegram UI flow that receives a video URL, lets the user choose an action/format, queues download jobs, and reports results back to the chat.
- Keep the Telegram bot user-facing copy in Russian.
- Preserve the current architecture: Telegram adapter handles UI and messaging, core services handle metadata, format options, policy, jobs, downloads, and transcripts.

Constraints:

- Do not run long downloads or transcript extraction inside the webhook request lifecycle.
- Use `@grammyjs/menu` for the primary Telegram UI instead of manually assembled inline keyboards.
- Keep `@grammyjs/menu` out of core and server layers; use it only in the Telegram adapter/UI layer.
- Add `callback_query` to configured `allowed_updates` when menu callbacks are introduced.
- Store initial selection sessions in memory for the first version: `chatId + messageId -> url + title + duration + format options + expiresAt`.
- File size policy for Telegram UI: show `too_large` only when expected output file size is strictly greater than 2 GiB. Unknown size must be represented separately as `unknown_size`, not as too large.
- Russian bot copy is required for all user-facing Telegram messages and buttons.

Decisions:

- Main interaction shape: URL -> quick Russian acknowledgement -> background metadata/options preparation -> menu -> user action -> job enqueue -> worker completion -> send file or error message.
- Use a fixed 15 minute in-memory menu-session TTL for the first version.
- Do not display queue position in the first version; show the created job id when a download/transcript job is accepted.
- Send completed files and transcript documents through a dedicated Telegram result sender adapter composed in `src/server/index.ts`.
- Introduce a typed media-job model before UI wiring so metadata preparation, download/MP3, transcript extraction, result delivery, and cancellation share explicit states.
- Queue transcript extraction through the job layer immediately so webhook handlers do not run subtitle extraction inline.
- Use adapter-level Telegram display policy for the 2 GiB `too_large` threshold; keep core operational policy separate and map smaller operational rejections to distinct Telegram copy such as server/disk limit text.

Open questions:

- Whether the fixed 15 minute TTL should become configurable later.
- Whether queue position should be added in a later version.
- Whether Telegram cloud and Local Bot API upload limits need separate runtime enforcement after manual deployment testing.

## External API Notes

- `@grammyjs/menu` menus must be created and installed before callback updates are handled.
- Use `Menu`, `MenuRange`, `MenuFlavor`, dynamic ranges, `submenu`, `back`, `ctx.menu.update()`, `ctx.menu.nav()`, and `ctx.menu.close()` for the Telegram UI.
- Use Russian `onMenuOutdated` behavior and a stable menu `fingerprint` derived from non-secret session/menu state when dynamic ranges depend on stored session data.
- If `allowed_updates` is configured manually during webhook registration, include both `message` and `callback_query`.
- Telegram cloud Bot API upload limits are much lower than Local Bot API server upload limits; do not claim 2 GiB file delivery without Local Bot API testing.

## Commit Plan

- [ ] **Commit 1** (after tasks 1-4): "feat: add telegram menu session foundation"
- [ ] **Commit 2** (after tasks 5-10): "feat: queue telegram media actions and menus"
- [ ] **Commit 3** (after tasks 11-12): "feat: wire telegram menu flow"
- [ ] **Commit 4** (after tasks 13-14): "test: cover telegram menu flow"
- [ ] **Commit 5** (after task 15): "docs: document telegram menu flow"

## Tasks

### Phase 1: Menu Foundation

- [x] Task 1: Add grammY menu dependency and Telegram menu context types.
  - [ ] Deliverable: add `@grammyjs/menu` to package metadata and lockfiles, then create a Telegram adapter context/type module for menu handlers.
  - [ ] Expected behavior: `src/adapters/telegram` can type menu handlers with `MenuFlavor` without leaking `@grammyjs/menu` imports into `src/core` or `src/server`; package scripts continue to work with Node ESM and explicit `.js` imports.
  - [ ] Files: `package.json`, `package-lock.json`, `bun.lock`, `src/adapters/telegram/context.ts`.
  - [ ] Logging requirements: no runtime logging in type-only modules; package scripts must preserve `LOG_LEVEL` behavior and not hide dependency or build failures.
  - [ ] Dependencies: none.

- [x] Task 2: Add in-memory Telegram menu session storage with TTL cleanup.
  - [ ] Deliverable: create an adapter-owned session store keyed by `chatId + messageId`, storing URL, sanitized title, duration, serializable format options, creation time, expiration time, and current menu state.
  - [ ] Expected behavior: session keys use the chat id and the Telegram message id for the message that contains the menu; callback handlers derive the same key from `callbackQuery.message`. Sessions expire after 15 minutes, expired or missing lookups return typed `expired`/`missing` states that callers map through Russian copy helpers, cancellation removes the session, and cleanup is idempotent. The store exposes an injectable clock or explicit `pruneExpired(now)` path so TTL behavior is deterministic in tests. The store must not persist URLs, titles, or Telegram ids outside memory.
  - [ ] Files: `src/adapters/telegram/menu-session-store.ts`, `src/adapters/telegram/menu-session-store.test.ts`.
  - [ ] Logging requirements: log session create/update/delete/expire at `DEBUG`; log unexpected missing-session paths at `WARN` with chat/message ids only, never raw URLs or bot tokens.
  - [ ] Dependencies: task 1.

- [x] Task 3: Add Russian Telegram copy and display-policy helpers.
  - [ ] Deliverable: create adapter helpers for user-facing Russian messages, button labels, format labels, duration formatting, job accepted/running/completed/failed messages, transcript messages, and policy explanations.
  - [ ] Expected behavior: `/start`, invalid URL, analyzing URL, metadata failure, main menu, quality menu, expired/missing session, queue accepted/full, running, completed, failed, cancelled, too-large, unknown-size, and transcript-missing text are all Russian. The helper must map `expectedSizeBytes > 2 * 1024 * 1024 * 1024` to Telegram `too_large`; `expectedSizeBytes <= 2 GiB` must never be displayed as `too_large`; missing size must display as `unknown_size`; core operational file-size or disk rejections under this threshold must get distinct copy.
  - [ ] Files: `src/adapters/telegram/copy.ts`, `src/adapters/telegram/telegram-policy.ts`, `src/adapters/telegram/copy.test.ts`.
  - [ ] Logging requirements: pure copy/policy helpers should not log; callers must log policy decisions at `DEBUG` using reason codes such as `too_large`, `unknown_size`, `server_limit`, or `insufficient_disk`.
  - [ ] Dependencies: none.

- [x] Task 4: Add a reusable selection snapshot method for Telegram menus.
  - [ ] Deliverable: extend `VideoDownloadService` with a method that fetches metadata once and returns sanitized title, duration, and `SerializableFormatOption[]` with policy state.
  - [ ] Expected behavior: Telegram menu preparation does not call `yt-dlp --dump-json` twice for the same URL; live streams and invalid URLs still fail with typed errors; core remains independent of grammY, Fastify, Termcast, and `@grammyjs/menu`.
  - [ ] Files: `src/core/services/video-download-service.ts`, `src/core/types.ts`, `src/core/helpers.test.ts`.
  - [ ] Logging requirements: log snapshot start/finish at `DEBUG` with duration and format count; log validation/live-stream/policy errors through existing typed error paths without raw URLs.
  - [ ] Dependencies: none.

### Phase 2: Job, Menu, And Result Flow

- [x] Task 5: Define typed media jobs and atomic job state transitions.
  - [ ] Deliverable: evolve the current download-only job model into a typed media job model for metadata preparation, download/MP3, and transcript actions, with typed command payloads and typed completion results.
  - [ ] Expected behavior: `JobService` records each job before it can be delivered to a waiting worker, including the current immediate-waiter queue path where `enqueue` can hand work to a worker synchronously. If enqueueing fails, the job record is rolled back or marked failed without leaving a phantom queued job. Workers never lose the first `running` transition, terminal jobs are not overwritten by later worker updates, guarded update helpers refuse invalid terminal-to-nonterminal transitions, and existing `createDownloadJob` behavior remains compatible through a wrapper or migration path. The queue boundary must remain replaceable later; if queued cancellation requires removal, add an explicit queue operation or implement a worker-side skip for already-cancelled jobs.
  - [ ] Files: `src/core/jobs/queue.ts`, `src/core/jobs/job-service.ts`, `src/core/jobs/download-worker.ts` or `src/core/jobs/media-worker.ts`, `src/core/jobs/jobs.test.ts`.
  - [ ] Logging requirements: log create/start/finish/failure/cancel at `INFO`, detailed state transitions at `DEBUG`, queue-full at `WARN`, unexpected worker failures at `ERROR`; include job id, action, status, and chat presence only, not raw URLs.
  - [ ] Dependencies: task 4.

- [x] Task 6: Extend worker orchestration for Telegram media actions.
  - [ ] Deliverable: add queued worker support for metadata preparation, best-video download, selected-format download, MP3 extraction, and transcript extraction while preserving current download job behavior.
  - [ ] Expected behavior: URL message handling enqueues metadata-preparation work after the quick acknowledgement; metadata completion produces a selection snapshot for the Telegram adapter; menu actions enqueue download or transcript work; long `yt-dlp`, `ffmpeg`, subtitle extraction, and transcoding work does not run inside the webhook request lifecycle. Transcript actions use `TranscriptService`, MP3 actions use the existing MP3 format value, and existing download jobs remain compatible with current tests.
  - [ ] Files: `src/core/jobs/queue.ts`, `src/core/jobs/job-service.ts`, `src/core/jobs/download-worker.ts` or `src/core/jobs/media-worker.ts`, `src/core/jobs/jobs.test.ts`, `src/core/services/transcript-service.ts` if command wiring changes.
  - [ ] Logging requirements: log worker dispatch by action at `INFO`, metadata/transcript/download state transitions at `DEBUG`, policy rejections at `WARN`, and unexpected worker failures at `ERROR`; include job id/action/chat presence only, not raw URLs or transcript text.
  - [ ] Dependencies: task 5.

- [x] Task 7: Build root and quality selection menus with `@grammyjs/menu`.
  - [ ] Deliverable: create root and quality submenu definitions under the Telegram adapter layer before metadata dispatch or bot installation tries to use them.
  - [ ] Expected behavior: root menu shows best video download, choose quality, MP3, transcript, and cancel; quality menu uses a dynamic range from `SerializableFormatOption`; disabled or limited options are clearly labeled in Russian, answer the callback in Russian, and do not enqueue work; enabled action callbacks call injected action handlers instead of directly owning job orchestration. `submenu` and `back` are used for navigation; menus use stable non-secret ids; root menu registers submenus before installation; stale/expired menu sessions are handled through Russian `onMenuOutdated`, a stable session/menu `fingerprint`, explicit session lookup before dispatch, and `ctx.menu.update()` or `ctx.menu.close()` when needed. The cancel button may call an injected cancellation handler, with full queued/running cancellation semantics completed in task 10.
  - [ ] Files: `src/adapters/telegram/menus/download-menu.ts`, `src/adapters/telegram/menus/format-menu.ts`, `src/adapters/telegram/menus/menu-state.ts`, `src/adapters/telegram/menus/download-menu.test.ts`.
  - [ ] Logging requirements: log menu render and button action dispatch at `DEBUG` with session key/action/format id; log expired or stale callback handling at `WARN`; do not log raw URLs.
  - [ ] Dependencies: tasks 1, 2, 3, 5, and 6.

- [x] Task 8: Add Telegram metadata result dispatcher for prepared menus.
  - [ ] Deliverable: create an adapter that receives completed metadata-preparation job results, creates the menu session, and sends or edits the Telegram message that contains the root menu from task 7.
  - [ ] Expected behavior: metadata preparation completes outside the webhook lifecycle, then the dispatcher maps the snapshot into the session store using the actual menu message id, sends Russian metadata failure copy when preparation fails, and never calls `yt-dlp --dump-json` again for the same prepared menu. Dispatcher failures are reported to the chat without leaking internal errors and mark/report the job failure path consistently with other media jobs.
  - [ ] Files: `src/adapters/telegram/metadata-result-dispatcher.ts`, `src/adapters/telegram/metadata-result-dispatcher.test.ts`, `src/adapters/telegram/menu-session-store.ts`, `src/adapters/telegram/menus/download-menu.ts`, `src/core/jobs/download-worker.ts` or `src/core/jobs/media-worker.ts`, `src/server/index.ts`.
  - [ ] Logging requirements: log metadata result dispatch start/finish at `INFO`, session/message creation at `DEBUG`, preparation failures at `WARN`, unexpected send/store failures at `ERROR`; include job id, chat id presence, message id, and reason codes only, not raw URLs or bot tokens.
  - [ ] Dependencies: tasks 2, 3, 4, 6, and 7.

- [x] Task 9: Add Telegram result sender adapter for completed jobs.
  - [ ] Deliverable: create an adapter that sends completed video/audio files and transcript results to Telegram, handles Russian success/failure messages, and owns Telegram-specific file sending choices.
  - [ ] Expected behavior: completed downloads are sent back to the originating chat before cleanup runs; transcript results are sent as a normal message when short enough and as a temporary `.md` or `.txt` document when too long; temporary transcript documents are cleaned up after success or failure; send failures mark/report the job failure without leaking internal errors to users. The adapter should support standard grammY `Bot.api` and optional `TELEGRAM_API_ROOT` configured in the bot client, distinguish Telegram cloud upload limits from Local Bot API limits, and never imply that every `<= 2 GiB` file is deliverable through the cloud Bot API.
  - [ ] Files: `src/adapters/telegram/result-sender.ts`, `src/adapters/telegram/result-sender.test.ts`, `src/core/jobs/download-worker.ts` or `src/core/jobs/media-worker.ts`, `src/server/index.ts`.
  - [ ] Logging requirements: log send start/finish at `INFO`, file type and transcript delivery mode at `DEBUG`, send failures at `ERROR`, and cleanup handoff at `DEBUG`; never log bot tokens, full file contents, or full transcript text.
  - [ ] Dependencies: tasks 3 and 6.

- [x] Task 10: Add cancellation behavior for queued/running Telegram jobs and active menu sessions.
  - [ ] Deliverable: expose cancel handling from Telegram menu callbacks through the job service/worker and session store, including explicit queued-job cancellation semantics.
  - [ ] Expected behavior: pressing "Отмена" closes or updates the menu, removes the session, cancels queued work so it will not run later, aborts active work when possible, and sends Russian cancellation confirmation. Cancelling an already completed, failed, cancelled, missing, or expired job must be idempotent and user-friendly.
  - [ ] Files: `src/adapters/telegram/menus/download-menu.ts`, `src/adapters/telegram/menu-session-store.ts`, `src/core/jobs/queue.ts`, `src/core/jobs/in-memory-queue.ts`, `src/core/jobs/job-service.ts`, `src/core/jobs/download-worker.ts` or `src/core/jobs/media-worker.ts`, `src/core/jobs/jobs.test.ts`.
  - [ ] Logging requirements: log cancellation requested/accepted/not-found/already-terminal at `INFO` or `WARN`; log worker abort propagation and queued-job removal/skip at `DEBUG`; do not log URLs or transcript text.
  - [ ] Dependencies: tasks 2, 3, 5, 6, 7, and 9.

### Phase 3: Telegram Bot Wiring

- [x] Task 11: Refactor Telegram bot adapter to use the menu flow.
  - [ ] Deliverable: update `createTelegramBot` and text handling to install menu middleware, handle `/start`, validate URL messages, send the quick acknowledgement, enqueue menu preparation, and delegate prepared-menu delivery to the metadata result dispatcher.
  - [ ] Expected behavior: invalid text receives Russian invalid-URL copy; valid URLs receive Russian "Проверяю ссылку..." quickly; metadata-preparation jobs are enqueued rather than run inline; prepared sessions are displayed by the metadata result dispatcher with title and duration; callbacks enqueue work and update/close menus without blocking the webhook. Existing queue-full and unexpected enqueue failures remain handled.
  - [ ] Files: `src/adapters/telegram/bot.ts`, `src/adapters/telegram/bot.test.ts`, `src/adapters/telegram/menus/*.ts`.
  - [ ] Logging requirements: log update received, command/text/callback routing, quick acknowledgement, preparation enqueue, menu prepared, and callback action at `INFO`/`DEBUG`; log validation and queue-full at `WARN`; log unexpected adapter failures at `ERROR`; never log secrets or raw URLs.
  - [ ] Dependencies: tasks 7, 8, 9, and 10.

- [x] Task 12: Wire server composition and webhook allowed updates.
  - [ ] Deliverable: update server startup composition to create the session store, menu/result adapters, transcript service, job callbacks, and a testable webhook registration helper.
  - [ ] Expected behavior: webhook registration passes `allowed_updates: ["message", "callback_query"]` through a helper that can be unit-tested without starting the server; `src/server/app.ts` stays side-effect-light and testable through `fastify.inject()`; `src/server/index.ts` owns startup side effects; if `DownloadWorker` is replaced by a media worker, server app typing uses a narrow stoppable-worker boundary instead of a concrete worker class; core services and server layers still do not import `@grammyjs/menu`.
  - [ ] Files: `src/server/index.ts`, `src/server/app.ts`, `src/server/webhook-registration.ts`, `src/server/server.test.ts`, `src/core/jobs/worker.ts` if a shared worker lifecycle type is needed, `src/core/services/transcript-service.ts` if constructor composition changes.
  - [ ] Logging requirements: log composed feature flags and webhook allowed updates at `INFO`; log startup composition failures at `ERROR`; redact webhook URLs and never log bot tokens or webhook secrets.
  - [ ] Dependencies: tasks 6, 8, 9, 10, and 11.

### Phase 4: Tests And Documentation

- [x] Task 13: Add focused adapter and core tests for the menu flow.
  - [ ] Deliverable: cover session TTL, Russian copy/policy mapping, dynamic format rendering inputs, bot text handling, metadata result dispatch, queue-full cases, media job action creation, queued and running cancellation, transcript document fallback and cleanup, webhook `callback_query` registration, no duplicate metadata fetches during menu preparation, and no raw URLs/secrets in Telegram/job logs.
  - [ ] Expected behavior: tests run through `npm run test:core` without real Telegram credentials, network, `yt-dlp`, `ffmpeg`, or downloads; mocks assert the webhook handler acknowledges quickly and delegates long work to background jobs; metadata completion creates the menu session/message asynchronously; queued cancellation prevents later execution; menu preparation calls metadata lookup once for a URL snapshot; stub loggers assert high-risk warning/error paths without storing raw user URLs, bot tokens, webhook secrets, full file contents, or transcript text.
  - [ ] Files: `src/adapters/telegram/*.test.ts`, `src/adapters/telegram/menus/*.test.ts`, `src/core/jobs/jobs.test.ts`, `src/server/server.test.ts`.
  - [ ] Logging requirements: tests should use stub loggers to assert important warning/error paths without noisy console output; do not snapshot full log payloads containing user input.
  - [ ] Dependencies: tasks 1-12.

- [x] Task 14: Run build and test verification, then fix regressions.
  - [ ] Deliverable: run the relevant quality gates and address compile/test failures in the touched files.
  - [ ] Expected behavior: TypeScript ESM imports have explicit `.js` suffixes, `npm run backend:build` passes, `npm run test:core` passes, and `npm run build` is attempted to check Termcast compatibility.
  - [ ] Files: touched source/test files only.
  - [ ] Logging requirements: if verification exposes noisy logs, adjust tests or log levels so routine test runs stay readable while preserving runtime diagnostics.
  - [ ] Dependencies: task 13.

- [x] Task 15: Update Telegram backend documentation through the docs checkpoint.
  - [ ] Deliverable: update `README.md` and, if useful, `docs/` through `$aif-docs` to describe the new Telegram menu flow.
  - [ ] Expected behavior: docs mention Russian Telegram UX, menu actions, `@grammyjs/menu`, `allowed_updates` including `callback_query`, session TTL, queue limits, transcript document fallback, `TELEGRAM_API_ROOT`, cloud vs Local Bot API file-size realities, and the distinction between operational policy and Telegram 2 GiB display threshold.
  - [ ] Files: `README.md`, optional `docs/*`.
  - [ ] Logging requirements: document `LOG_LEVEL=debug` as the way to inspect verbose menu/job diagnostics; do not add runtime logs solely for documentation.
  - [ ] Dependencies: task 14.

## Quality Gates

- [x] `npm run backend:build` passes.
- [x] `npm run test:core` passes without external binaries, Telegram credentials, network, or real downloads.
- [x] `npm run build` is attempted and any Termcast compatibility issue is reported or fixed. Attempted locally; it fails because `/usr/bin/env` cannot find `bun`.
- [x] Webhook check: URL messages and callback queries return quickly; no long download, transcript extraction, ffmpeg conversion, file upload, or metadata preparation blocks the Fastify webhook response.
- [x] Metadata-result check: metadata-preparation completion creates exactly one menu session/message asynchronously and does not refetch metadata for the same prepared menu.
- [x] Job-state check: media jobs are recorded before worker delivery, queued cancellation prevents later execution, and terminal job statuses are not overwritten by worker completion/failure paths.
- [x] Boundary check: `src/core` imports no Termcast, React, grammY, Fastify, or `@grammyjs/menu`; `src/server` imports no `@grammyjs/menu`.
- [x] Menu check: menu UI uses `@grammyjs/menu` rather than manually assembled inline keyboards for the primary flow.
- [x] Policy check: Telegram UI displays `too_large` only when `expectedSizeBytes > 2 GiB`; unknown sizes display as `unknown_size`; core operational policy remains separate.
- [x] Copy check: all Telegram user-facing messages and buttons are Russian.
- [x] Secret check: logs and errors do not include bot tokens, webhook secrets, raw secret-bearing webhook URLs, raw URLs from users, full file contents, or full transcript text.
- [x] Docs check: documentation covers the menu flow, environment, webhook `allowed_updates`, Local Bot API notes, session TTL, queue behavior, and verification commands.
