<!-- handoff:task:088bf94e-b7c7-49a4-bf93-b5bdd03cb6c2 -->
# Implementation Plan: Telegram Inline Menu Download Progress

Branch: feature/telegram-inline-menu-progress
Created: 2026-05-12

## Settings
- Testing: yes
- Logging: verbose
- Docs: no

## Roadmap Linkage
Milestone: "none"
Rationale: `.ai-factory/ROADMAP.md` is not present in this checkout, so there is no roadmap milestone to link.

## Research Context
Source: `.ai-factory/RESEARCH.md`

No active research summary is available in this checkout. The file is currently deleted in the working tree before this plan was created.

## Requirements Summary
- After selecting a video/audio format in Telegram inline menus, do not send the current two follow-up messages (`downloadStarted`, `queueAccepted`).
- Reuse the original menu message by editing its text to a live progress message whose primary line is `Скачивание запущено: <downloaded> / <total>` and whose next line renders a compact text progress bar from the same progress state.
- Replace the inline keyboard with only `Назад` and `Отмена`.
- Store the original menu `chatId`, `messageId`, and selected option estimated size in the created `MediaJob` payload so background progress and completion handlers can use `bot.api.editMessageText` / `bot.api.editMessageMedia` and render `X / Y` size progress.
- Keep `core/jobs` independent of Telegram. The worker may emit generic progress callbacks, while Telegram-specific message edits live under `src/adapters/telegram/`.
- Emit parseable yt-dlp progress with `--progress-template` and parse streamed stdout/stderr lines into percent, downloaded bytes, total bytes, and total estimated bytes; throttle Telegram edits so progress updates are not sent for every line.
- Render the displayed total size from the job-level selected option estimate when present; otherwise use yt-dlp `total_bytes` / `total_bytes_estimate`. If no total is known, render the downloaded size with an unknown-total label instead of fabricating `Y`.
- For merged downloads or stage resets, keep visible downloaded bytes monotonic by accumulating completed stages and cap visible downloaded bytes at the displayed total when that total is known.
- Keep progress sessions cancellable while a job is active, even when the normal menu TTL would otherwise expire.
- Terminal cleanup must prevent delayed fire-and-forget progress callbacks from re-editing completed, failed, or cancelled messages.
- On completion, prefer replacing the original progress message media with the MP4 via `editMessageMedia`; fallback to existing sendVideo/sendDocument behavior and update the original progress message to done/error text.
- Cancel button must cancel queued/running jobs through existing `DownloadWorker.cancel` / `JobService.cancelJob`.
- Safe decision for `Назад`: once a job has been created, `Назад` does not return to selectable formats and does not leave a hidden running job behind. It answers the callback with current running/accepted state and keeps the progress keyboard visible. Format navigation is only available before job creation.

## Commit Plan
- **Commit 1** (after tasks 1-4): `feat: model download progress for telegram jobs`
- **Commit 2** (after tasks 5-13, including Task 6.5): `feat: update telegram menu message during downloads`
- **Commit 3** (after tasks 14-17): `test: cover telegram inline progress flow`

## Tasks

### Phase 1: Core Progress Model
- [x] Task 1: Add a generic download progress type and yt-dlp parser.

  Deliverable:
  - Add `DownloadProgress` as a core-safe type, preferably in `src/core/types.ts` or a small dedicated module such as `src/core/download-progress.ts`.
  - Include `percent?: number`, `downloadedBytes?: number`, `totalBytes?: number`, `totalBytesEstimate?: number`, optional `rawLine?: string`, and optionally `source?: "stdout" | "stderr"`.
  - Add `parseYtDlpDownloadProgress(line: string): DownloadProgress | undefined` near the low-level integration boundary, likely in `src/integrations/yt-dlp.ts`, or a core-safe parser module if it stays free of process details.
  - Configure `downloadVideo` to request stable progress output with `--progress-template` using a unique prefix, for example a tab-delimited line containing `progress.status`, `progress.downloaded_bytes`, `progress.total_bytes`, `progress.total_bytes_estimate`, and `progress._percent_str`.
  - Parser must prefer the unique progress-template prefix, parse numeric byte fields when present, tolerate `NA` / `N/A` / empty missing values, clamp/validate percent to `0..100`, and ignore unrelated output.
  - Parser may keep a fallback for existing/default yt-dlp lines like `[download]  37.5% of ...`, but implementation should not depend on default human-readable stdout for the new byte display.
  - It must tolerate repeated, lower, and stage-reset percentages/byte counts without applying monotonic policy; stage accumulation, monotonic, and throttle behavior belongs in dispatcher state.
  - Preserve `parsePrintedFilePath` behavior when structured progress-template lines are mixed with `--print after_move:filepath` output; add a regression where prefixed progress lines appear before the final printed local path.

  Files:
  - `src/core/types.ts` or `src/core/download-progress.ts`
  - `src/integrations/yt-dlp.ts`
  - `src/core/helpers.test.ts` or a new focused parser test beside the parser

  Logging requirements:
  - Parser itself should not log on every line.
  - Add DEBUG logging only at the caller/worker boundary for accepted progress values, and never log raw URLs or unbounded process output.

- [x] Task 2: Verify streamed process line callbacks are suitable for live progress.

  Deliverable:
  - Audit and, if needed, update `runStreamingCommand` in `src/integrations/process.ts` so `onStdoutLine` and `onStderrLine` are invoked for complete streamed lines while the process is still running.
  - Preserve the existing accumulated `stdout`/`stderr` return values used by `parsePrintedFilePath`; progress observation must not remove data from the final command result.
  - Flush trailing partial line remainders on successful process completion.
  - Decide and document behavior for trailing partial lines when the process fails, times out, or is cancelled. Prefer processing already-complete lines during streaming and avoid treating failure-path remainder flushing as required for progress correctness.
  - Ensure observer callback errors cannot crash from an EventEmitter data handler or hide the original process failure. `runStreamingCommand` should invoke observers through a small safe helper that catches observer exceptions, logs only sanitized `{ phase, stream }` context, and continues streaming.
  - Keep the worker-level progress callback guard from Task 3 as a second boundary; process observer failures and Telegram progress failures must not fail the download job.
  - Keep argument and output redaction behavior from `src/integrations/process.ts` unchanged.

  Files:
  - `src/integrations/process.ts`
  - `src/core/helpers.test.ts` or a new focused process integration test

  Logging requirements:
  - DEBUG logs may report streamed line observer failures only with `{ phase, stream }`.
  - Do not log raw streamed lines, raw URLs, bot tokens, local file paths, or full command output.

- [x] Task 3: Thread generic progress callbacks through `DownloadWorker`.

  Deliverable:
  - Extend `DownloadWorkerOptions` in `src/core/jobs/download-worker.ts` with `onJobProgress?: (job: MediaJob, progress: DownloadProgress) => Promise<void> | void`.
  - For `download_best`, `download_format`, and legacy `extract_mp3`, pass `onStdoutLine` and `onStderrLine` into `VideoDownloadService.download`.
  - Treat `VideoDownloadService.download`'s existing line-hook support as the service boundary; avoid reworking the service API beyond any typing needed for `DownloadProgress`.
  - Each line should be parsed with `parseYtDlpDownloadProgress`; when a progress value is found, call `onJobProgress(job, progress)`.
  - Bridge the synchronous line hooks to the possibly async `onJobProgress` callback deliberately, for example with `void Promise.resolve(onJobProgress(job, progress)).catch(...)`.
  - Wrap progress callback errors so they are logged and do not fail the download job or escape from streaming line handlers.
  - Do not emit progress for `prepare_metadata` or `extract_transcript`.

  Files:
  - `src/core/jobs/download-worker.ts`
  - `src/core/jobs/jobs.test.ts`

  Logging requirements:
  - DEBUG: progress parsed and emitted with `{ jobId, action, percent, downloadedBytes, totalBytes, totalBytesEstimate, source }`.
  - WARN: progress callback failure with `{ jobId, action, percent, downloadedBytes, error }`.
  - No raw yt-dlp line in routine logs unless bounded/redacted and only at DEBUG.

- [x] Task 4: Preserve original Telegram menu message identity and expected size on created jobs.

  Deliverable:
  - Extend format selection handler input to carry the selected option's `estimatedSizeBytes` along with `formatValue`, or pass the selected `SerializableFormatOption` and derive both fields from it.
  - Update all three format-selection call sites to pass the selected option data: root MP4 selection in `src/adapters/telegram/menus/download-menu.ts`, nested quality selection in `src/adapters/telegram/menus/format-menu.ts`, and audio selection in `src/adapters/telegram/menus/format-menu.ts`.
  - Ensure the server-composed format selection handler passes `menuMessageId: session.messageId` and `expectedSizeBytes: option.estimatedSizeBytes` into `jobService.createMediaJob`.
  - Confirm `MediaJobPayload` supports `menuMessageId?: number` and add `expectedSizeBytes?: number`; add type tests or direct assertions if needed.
  - Keep `chatId` on the job unchanged.
  - Keep the current `ctx.reply(telegramCopy.downloadStarted)` and `ctx.reply(telegramCopy.queueAccepted(job.id))` follow-up behavior until Task 11 provides the immediate byte-based initial progress edit path. Do not leave an intermediate implementation checkpoint where a successful selection only closes/answers the callback without visible progress feedback.
  - On queue-full/error before job creation, keep current callback-query failure behavior and leave the selectable menu intact.

  Files:
  - `src/server/index.ts`
  - `src/adapters/telegram/menus/download-menu.ts`
  - `src/adapters/telegram/menus/format-menu.ts`
  - `src/core/jobs/queue.ts` if type refinement is needed
  - `src/adapters/telegram/menus/download-menu.test.ts`
  - `src/server/server.test.ts` only if server composition needs a seam for testing

  Logging requirements:
  - INFO: job created from Telegram menu with `{ jobId, action, hasChatId, menuMessageId, hasExpectedSizeBytes }`.
  - WARN: queue creation failure already exists; include whether a menu message id was present.
  - If this task is implemented separately from Task 11, do not add tests that assert follow-up replies are removed yet; that assertion belongs with the initial progress edit in Task 11 / Task 15.

### Phase 2: Telegram Menu Progress UX
- [x] Task 5: Add progress-state session modeling for the original menu message.

  Deliverable:
  - Extend `TelegramMenuState` with guarded active states, for example `"starting"` and `"progress"`.
  - Store `activeJobId` when the job is accepted and update the session state to progress instead of closed.
  - Add duplicate job-start protection for repeated callback taps. Before awaiting job creation, move the session into a short-lived guarded state such as `"starting"` or an equivalent adapter-local in-flight marker; callbacks that see `state: "starting"`, `state: "progress"`, or an existing `activeJobId` must answer with `telegramCopy.running` and must not create another job. If job creation fails before enqueueing, roll the session back to its previous selectable state so the user can retry.
  - Implement the guard through a narrow store/helper operation such as `tryMarkStarting(key, previousSelectableState)` or an equivalent atomic re-read/update flow. A plain unconditional `store.update` is not enough because duplicate callback handlers can race between lookup and enqueue.
  - Keep active progress sessions cancellable beyond the normal 15 minute menu TTL. Either renew/extend `expiresAt` when a session enters `"progress"`, or make `TelegramMenuSessionStore.get` / `pruneExpired` preserve sessions with `state: "progress"` and `activeJobId` until terminal cleanup deletes them.
  - Replace the current `state: "closed"` + `ctx.menu.close()` behavior in all format-selection paths:
    root MP4 selection in `src/adapters/telegram/menus/download-menu.ts`, nested quality selection in
    `src/adapters/telegram/menus/format-menu.ts`, and audio selection in the same file.
  - If progress needs additional stored fields beyond `state`, `selectedContainer`, `activeJobId`, and selected expected size, widen `TelegramMenuSessionStore.update` patch typing instead of bypassing the store.
  - Add any stable "already running" callback text if needed.
  - Update `menuFingerprint` so active states and `activeJobId` reliably invalidate rendered menu markup.
  - Leave progress keyboard callback routing and shared text/markup rendering to Tasks 6-7 so state changes do not introduce orphan callback data or duplicate render implementations.

  Files:
  - `src/adapters/telegram/menu-session-store.ts`
  - `src/adapters/telegram/copy.ts`
  - `src/adapters/telegram/menus/download-menu.ts`
  - `src/adapters/telegram/menus/format-menu.ts`
  - `src/adapters/telegram/menus/menu-state.ts` if render helpers need state-aware keyboard support
  - `src/adapters/telegram/menu-session-store.test.ts`
  - `src/adapters/telegram/menus/download-menu.test.ts`

  Logging requirements:
  - DEBUG: session state transitions to progress/cancelled with `{ chatId, messageId, jobId }`.
  - INFO: duplicate/in-flight format callbacks ignored with `{ chatId, messageId, activeJobId }`.
  - INFO: user cancellation requested from progress UI with `{ jobId }`.
  - WARN: cancellation requested for missing/expired/no-active-job sessions.

- [x] Task 6: Define and implement the registered callback-data strategy for the progress keyboard.

  Deliverable:
  - Use the project-preferred menu-backed strategy: render progress buttons through the existing `@grammyjs/menu` root menu by branching on `session.state === "progress"` / active `activeJobId`.
  - Root menu rendering must render only progress-state buttons while a job is active. Normal root navigation (`Другие форматы`, `Извлечь аудио`, and selectable formats) must not be reachable while `state` is `"starting"` or `"progress"`.
  - Guard stale callback data as well as freshly rendered markup. Existing callback data for `Другие форматы`, `Извлечь аудио`, container choices, quality choices, and audio choices must re-check current session state and answer `telegramCopy.running` without navigation or enqueueing while the session is `"starting"` or `"progress"`.
  - Render the progress keyboard with only `Назад` and `Отмена` through registered menu buttons.
  - Implement `Назад` safely for running jobs: do not navigate to format choices and do not cancel. It should answer the callback with `telegramCopy.running` or equivalent and keep the progress screen visible.
  - Implement `Отмена` from progress state by calling existing `onCancel`, updating/editing the original message to cancelled state, and preventing duplicate cancellation failures from leaking to users.
  - Do not create direct `callback_data` values in shared renderer/dispatcher output. Progress callback data should come from `@grammyjs/menu` rendering only.
  - If worker-side edits need reply markup outside a live callback context, render markup through the same registered root menu with a synthetic context (`menus.renderRootMenuMarkup(chatId, messageId)`) after session state has been updated.
  - Add a focused test that renders the progress keyboard, extracts `Назад` / `Отмена` callback data, feeds those callback queries through a `Bot` with installed middleware, and verifies the intended handlers run.
  - Keep this strategy adapter-local; do not introduce grammY or Telegram API imports into `src/core/**`.

  Files:
  - `src/adapters/telegram/menus/download-menu.ts`
  - `src/adapters/telegram/menus/menu-state.ts`
  - `src/adapters/telegram/menus/progress-message.ts` or `src/adapters/telegram/progress-message.ts`
  - `src/adapters/telegram/menus/download-menu.test.ts`

  Logging requirements:
  - DEBUG: progress keyboard render/routing decisions with `{ chatId, messageId, jobId }`.
  - WARN: missing/expired/no-active-job progress callbacks.
  - Do not log callback payloads that include raw URLs or user-provided text.

- [x] Task 6.5: Extract shared Telegram error helpers before progress edit paths.

  Deliverable:
  - Move Telegram API error status/reason/text sanitization from `src/adapters/telegram/result-sender.ts` into an adapter-local utility such as `src/adapters/telegram/telegram-error.ts`.
  - Export narrow helpers for `telegramErrorStatusCode`, `telegramErrorReasonCode`, `sanitizeTelegramError`, and redacted text handling so result sender, progress dispatcher, edit-media fallback, and terminal cleanup logs use one implementation.
  - Preserve existing redaction behavior for quoted paths, unquoted paths with spaces, `file://` paths, URLs, bot tokens, and long token-like strings.
  - Keep upload-too-large classification either in `result-sender.ts` if it remains sender-specific, or export it only if a second caller needs it.
  - Update `TelegramResultSender` to import the shared helpers without changing current send behavior.

  Files:
  - `src/adapters/telegram/telegram-error.ts`
  - `src/adapters/telegram/result-sender.ts`
  - `src/adapters/telegram/telegram-error.test.ts`
  - `src/adapters/telegram/result-sender.test.ts`

  Logging requirements:
  - This helper must not log directly.
  - Callers must log only sanitized status/reason/text values from this helper.

- [x] Task 7: Add a shared Telegram progress message renderer.

  Deliverable:
  - Create a small adapter helper, likely under `src/adapters/telegram/menus/` or `src/adapters/telegram/`, that renders:
    - progress text via `telegramCopy.downloadProgress(progressView)` as `Скачивание запущено: <downloaded> / <total>`;
    - a compact text progress bar derived from visible percent, for example a fixed-width filled/empty bar plus optional percent on the bar line;
    - progress reply markup with only `Назад` and `Отмена`;
    - terminal text/markup states for done, failed, and cancelled when callers need to clear stale progress UI.
  - The helper should accept a normalized adapter-local progress view, including visible percent, visible downloaded bytes, displayed total bytes, and whether the displayed total is estimated/unknown.
  - Add a progress-specific byte formatter in `src/adapters/telegram/copy.ts` for progress text that renders `КБ`, `МБ`, and `ГБ` as required, without unintentionally changing existing menu size labels that currently use `formatTelegramBytes`.
  - The helper must not depend on worker state or `ctx.menu.update`; it should accept explicit job/session ids or simple state inputs.
  - Use the helper from immediate callback updates, the progress dispatcher, result-sender fallback cleanup, and cancellation cleanup so the original menu message cannot drift across paths.
  - Use the menu-backed callback routing strategy from Task 6 for reply markup. Prefer having callers request registered markup through `menus.renderRootMenuMarkup(chatId, messageId)` and pass it alongside renderer text, rather than having this helper handcraft callback data.
  - If the helper returns inline keyboard markup directly, ensure the callback data is produced by the registered menu strategy from Task 6. Do not create orphan callback data that grammY will receive but no code handles.
  - Use the sanitized Telegram API error helpers from Task 6.5 in callers that log progress edit, edit-media, fallback, and terminal cleanup failures.
  - Keep Telegram-specific rendering under `src/adapters/telegram/**`; do not introduce grammY/menu imports into `src/core/**`.

  Files:
  - `src/adapters/telegram/menus/progress-message.ts` or `src/adapters/telegram/progress-message.ts`
  - `src/adapters/telegram/copy.ts`
  - `src/adapters/telegram/menus/download-menu.test.ts` or a new focused renderer test

  Logging requirements:
  - Renderer itself should not log.
  - Callers should log progress/cancel/fallback outcomes at their own boundaries using the shared sanitized Telegram error helpers.

- [x] Task 8: Add a Telegram download progress dispatcher with throttled `editMessageText`.

  Deliverable:
  - Create `src/adapters/telegram/download-progress-dispatcher.ts`.
  - The dispatcher accepts a Bot API shape with `editMessageText(chatId, messageId, text, options)`.
  - It receives `(job, progress)` from `DownloadWorker.onJobProgress` and ignores jobs without `chatId` or `payload.menuMessageId`.
  - It updates the original menu message text to `Скачивание запущено: <downloaded> / <total>` plus the shared progress bar/keyboard/markup strategy from Tasks 6-7.
  - Derive displayed total bytes from `job.payload.expectedSizeBytes` first, then `progress.totalBytes`, then `progress.totalBytesEstimate`; render an unknown-total label if all are missing.
  - Derive displayed downloaded bytes from progress `downloadedBytes`, accumulating across stage resets so visible `X` does not go backwards; if only percent and total are known, do not present the computed value as exact downloaded bytes unless the copy/renderer marks it as estimated.
  - Throttle updates: update on integer percent change or visible formatted downloaded-size label change and no more often than once every 1-2 seconds, plus allow forced initial/terminal updates.
  - Accept an injectable clock/time source so throttling tests are deterministic and do not depend on real timers.
  - Handle repeated or smaller percentages/byte counts carefully: do not regress visible percent or visible downloaded bytes unless a clearly new stage policy is explicitly chosen. For this feature, prefer visible monotonic percent per job, visible monotonic bytes per job, and cap progress at 99% / displayed total until completion.
  - Swallow/log Telegram edit failures so download jobs continue.
  - Provide explicit terminal cleanup methods, for example `clear(jobId)`, `markCompleted`, `markFailed`, and `markCancelled`, or expose an equally narrow API for the composition contract in Task 9. Per-job throttle state must be cleared on terminal paths to avoid leaking dispatcher state.

  Files:
  - `src/adapters/telegram/download-progress-dispatcher.ts`
  - `src/adapters/telegram/download-progress-dispatcher.test.ts`
  - `src/adapters/telegram/copy.ts`
  - `src/adapters/telegram/menus/download-menu.ts` or a small reusable progress-keyboard renderer

  Logging requirements:
  - DEBUG: skipped progress updates with reason (`throttled`, `duplicate_progress`, `missing_menu_message`, `missing_size_change`).
  - INFO: sent progress update with `{ jobId, percent, downloadedBytes, totalBytes, messageId }`.
  - WARN: Telegram edit failure with sanitized error reason/status code.

- [x] Task 9: Define a server-composed progress cleanup contract.

  Deliverable:
  - Introduce a small adapter-level contract that coordinates terminal progress cleanup across the dispatcher, menu session store, and result sender. Keep it under `src/adapters/telegram/**` or as a narrow server composition helper; do not put Telegram code in `src/core/**`.
  - The contract should expose explicit operations needed by later tasks, for example:
    - `dispatch(job, progress)` or direct access to the dispatcher for worker progress;
    - `clear(jobId)` to clear dispatcher throttle state;
    - `markCompleted(job)`, `markFailed(job)`, and `markCancelled(job)` to update/remove the original progress message when `job.chatId` and `job.payload.menuMessageId` are present;
    - `deleteSession(job)` or `deleteSession({ chatId, messageId })` to remove the active menu session after terminal states.
  - Define ownership clearly:
    - dispatcher owns throttling state and non-terminal progress edits;
    - result sender owns media upload/edit-media attempts and fallback sends;
    - the composition contract owns shared terminal cleanup and session deletion;
    - menu callbacks own immediate callback answers and user-initiated cancellation requests.
  - Make `TelegramResultSender` accept only narrow callbacks/dependencies from this contract, rather than importing worker/server internals.
  - Add a focused test seam so server composition can be validated without starting polling/webhook mode. Prefer extracting a side-effect-light composition factory from `src/server/index.ts` that accepts already-created services/bot API/config dependencies and returns menus, progress dispatcher/cleanup contract, result sender, and worker callback wiring without calling `bot.start`, webhook registration, or `server.listen`.

  Files:
  - `src/server/index.ts`
  - `src/server/telegram-runtime.ts` or an equivalently narrow server composition module
  - `src/adapters/telegram/download-progress-dispatcher.ts`
  - `src/adapters/telegram/result-sender.ts`
  - `src/adapters/telegram/menu-session-store.ts`
  - `src/server/server.test.ts` or a new adapter composition test

  Logging requirements:
  - INFO: terminal cleanup accepted with `{ jobId, action, state, hasMenuMessage }`.
  - DEBUG: dispatcher state cleared and session delete result with `{ jobId, messageId, deleted }`.
  - WARN: terminal cleanup edit/session failures with sanitized Telegram status/reason.

- [x] Task 10: Add terminal progress suppression for delayed callbacks.

  Deliverable:
  - Extend the dispatcher/cleanup contract with an explicit terminal suppression path for completed, failed, and cancelled job ids. Clearing throttle state must not be the only terminal behavior.
  - When `markCompleted`, `markFailed`, or `markCancelled` is accepted for a job, record that job id as terminal before or while clearing per-job throttle state.
  - `TelegramDownloadProgressDispatcher.dispatch(job, progress)` must ignore later progress callbacks for terminal job ids, including callbacks scheduled before completion/cancellation with `void Promise.resolve(...).catch(...)`.
  - Keep suppression bounded so it cannot grow forever in a long-running process. Use a small TTL or max-entry pruning strategy with an injectable clock if tests need deterministic behavior.
  - Distinguish "clear transient throttle state" from "allow this job id to receive progress again". Job ids are unique, so terminal suppression should remain active long enough to absorb delayed callbacks and must not be removed by ordinary `clear(jobId)` calls that run during terminal cleanup.
  - Add tests that simulate a delayed progress callback after `markCompleted`, `markFailed`, and `markCancelled`, and assert no additional `editMessageText` call is made after the terminal edit/cleanup path.

  Files:
  - `src/adapters/telegram/download-progress-dispatcher.ts`
  - `src/server/telegram-runtime.ts` or the chosen cleanup contract module
  - `src/adapters/telegram/download-progress-dispatcher.test.ts`
  - `src/server/server.test.ts` or the chosen adapter composition test

  Logging requirements:
  - INFO: terminal suppression activated with `{ jobId, state }`.
  - DEBUG: terminal progress update ignored with `{ jobId, action, reason: "terminal" }`.
  - DEBUG: terminal suppression pruned with bounded counts only, no URLs or file paths.

- [x] Task 11: Compose progress dispatcher in server startup.

  Deliverable:
  - Instantiate `TelegramDownloadProgressDispatcher` in `src/server/index.ts` with `bot.api`, menu/session helpers, and logger.
  - Wire `DownloadWorker` with `onJobProgress: (job, progress) => progressDispatcher.dispatch(job, progress)`.
  - Replace the Task 4 temporary follow-up replies with the immediate progress UI: remove `ctx.reply(telegramCopy.downloadStarted)` and `ctx.reply(telegramCopy.queueAccepted(job.id))` only after the original menu message is edited to `0 КБ / <expected total or unknown size>` with the progress keyboard.
  - Verify and preserve the Task 4 job payload behavior: format download jobs created from Telegram menu sessions include `payload.menuMessageId: session.messageId` and `payload.expectedSizeBytes` when the selected option has an estimate.
  - After successful job creation from menu selection, immediately edit/update the original menu message to the initial byte-based progress message with progress keyboard from inside the callback/menu handler. This first update may use `ctx.editMessageText`/`ctx.menu.update` only while still inside the callback, or use the dispatcher in forced mode with stored ids.
  - Do not use `ctx.menu.update` from worker progress paths.
  - Confirm polling and webhook composition both use the same dispatcher.
  - Use the progress cleanup contract from Task 9 and terminal suppression from Task 10 instead of duplicating terminal cleanup logic directly in `onJobCompleted`, `onJobFailed`, and menu cancellation handlers.
  - Wire terminal progress cleanup consistently:
    - completed downloads should clear dispatcher state and update/replace the original message through `TelegramResultSender`;
    - failed download jobs should update the original progress message to a terminal failure state when `payload.menuMessageId` is present;
    - cancelled jobs should update the original progress message to cancelled state and clear any active session state.

  Files:
  - `src/server/index.ts`
  - `src/adapters/telegram/download-progress-dispatcher.ts`
  - `src/adapters/telegram/menus/download-menu.ts`

  Logging requirements:
  - INFO: server wiring includes progress dispatcher enabled.
  - DEBUG: immediate initial progress edit with `{ jobId, chatId, menuMessageId, hasExpectedSizeBytes }`.
  - WARN: initial edit failure should answer callback with failure only if job creation did not happen; after job creation, keep the job and show a non-blocking callback alert if possible.
  - WARN: any Telegram edit/startup callback error logs must use the shared sanitized Telegram error helper, not raw exception text.

### Phase 3: Completion, Fallbacks, Cancellation
- [x] Task 12: Add completion replacement of the progress message with MP4 media and fallback to current sender behavior.

  Deliverable:
  - Extend the Telegram result API type with `editMessageMedia`.
  - Also expose the minimal API needed to edit or clear the original progress message text/markup when media replacement is skipped or fails, such as `editMessageText` and/or `editMessageReplyMarkup`.
  - Update `TelegramResultSender.sendDownload` to prefer `editMessageMedia(chatId, menuMessageId, { type: "video", media: new InputFile(filePath), caption }, { ... })` for MP4 jobs that have `payload.menuMessageId`.
  - After successful `editMessageMedia`, clear the progress keyboard from the edited message, for example through `editMessageReplyMarkup` with empty/removed markup or equivalent Bot API options. Completed media messages must not keep stale `Назад` / `Отмена` buttons.
  - Preserve existing upload policy checks before edit/upload.
  - For non-MP4, missing `menuMessageId`, Telegram edit failure, or unsupported edit cases, fallback to current `sendVideo`/`sendDocument` behavior.
  - In fallback, update the original progress message to `Готово.` or an actionable failure state when possible using the shared progress/terminal message helper from Task 7, so the progress message does not stay stale.
  - When completion succeeds by either edit-media or fallback send, use the cleanup contract from Task 9 and terminal suppression from Task 10 to clear progress dispatcher state, suppress delayed progress callbacks, and mark/delete the menu session so progress callbacks and stale buttons cannot keep operating on a terminal job.
  - On pre-upload rejection (`POLICY_REJECTED`, configured Telegram upload limit) or final upload failure, update the original progress message to the terminal failure state when `payload.menuMessageId` is present before throwing/returning the existing already-notified error path.
  - For jobs with `payload.menuMessageId`, treat the original message edit as the primary failure notification. Only fall back to `sendMessage` when the original message cannot be edited, so users do not receive both an edited terminal progress message and a duplicate failure message.
  - Keep cleanup behavior unchanged: temp files are cleaned after completion/failure through existing worker `finally`.

  Files:
  - `src/adapters/telegram/result-sender.ts`
  - `src/adapters/telegram/result-sender.test.ts`
  - `src/adapters/telegram/result-errors.ts` only if a new already-notified path is needed
  - `src/adapters/telegram/telegram-error.ts`
  - `src/adapters/telegram/copy.ts`

  Logging requirements:
  - INFO: edit-media attempt and success with `{ jobId, mediaKind, messageId, uploadMode, sizeBucket }`.
  - WARN: fallback path with sanitized Telegram status/reason.
  - ERROR: final upload failure after all fallbacks, preserving existing redaction behavior for paths/tokens.

- [x] Task 13: Make cancellation reliable for queued and running progress jobs.

  Deliverable:
  - Ensure progress-state `Отмена` calls `DownloadWorker.cancel(jobId)` when worker exists and `jobService.cancelJob(jobId)` otherwise, matching current server behavior.
  - For queued jobs, cancellation must remove the job from `InMemoryJobQueue`.
  - For running jobs, cancellation must abort the active process through `AbortController`.
  - Return or otherwise expose a narrow cancellation result from `DownloadWorker.cancel` or the server-side cancellation helper, including previous status when available and whether queued removal / active abort occurred. Use that result for idempotent cleanup and logging instead of inferring state from side effects.
  - Remove the current cancellation follow-up reply (`ctx.reply(telegramCopy.cancelled)`) and edit the original menu message to `Отменено.` with no stale selectable format keyboard. Decide whether to leave a disabled/no-op keyboard or remove reply markup; prefer removing reply markup after cancellation.
  - Ensure `onJobFailed` does not send an extra failure message for intentional cancellations.
  - Use the cleanup contract from Task 9 and terminal suppression from Task 10 to clear dispatcher throttle state, suppress delayed progress callbacks, and clear active menu session state after accepted cancellation so later queued/running callbacks do not re-edit a cancelled progress message.

  Files:
  - `src/server/index.ts`
  - `src/adapters/telegram/menus/download-menu.ts`
  - `src/adapters/telegram/download-progress-dispatcher.ts` if it owns cancelled-state edit
  - `src/core/jobs/download-worker.ts` if cancellation callback behavior needs tightening
  - `src/core/jobs/jobs.test.ts`
  - `src/adapters/telegram/menus/download-menu.test.ts`

  Logging requirements:
  - INFO: cancellation accepted with `{ jobId, previousStatus }` where available.
  - DEBUG: queued removal result and active abort result.
  - WARN: duplicate or unknown cancellation requests.

### Phase 4: Verification and Documentation Check
- [x] Task 14: Add core progress and worker tests.

  Deliverable:
  - Add or update tests for:
    - `runStreamingCommand` invokes stdout/stderr line callbacks for streamed complete lines without losing final stdout/stderr.
    - Stream line observer failures do not fail the download job or hide the original process failure.
    - yt-dlp progress parser extracts percentages, downloaded bytes, total bytes, and estimated total bytes from progress-template stdout/stderr-like lines and ignores unrelated lines.
    - `parsePrintedFilePath` still returns the final printed local path when structured progress-template lines are present in stdout before the final `after_move:filepath` line.
    - `DownloadWorker` calls `onJobProgress` during downloads.
    - `DownloadWorker` does not emit progress for metadata or transcript jobs.
    - Queued cancellation removes jobs from `InMemoryJobQueue`; running cancellation aborts active processes through `AbortController`.

  Files:
  - `src/integrations/process.ts`
  - `src/core/helpers.test.ts`
  - `src/core/jobs/jobs.test.ts`

  Logging requirements:
  - Tests should assert important logger calls only where behavior depends on swallowed process observer errors or progress callback failures.

- [x] Task 15: Add menu progress and dispatcher tests.

  Deliverable:
  - Add or update tests for:
    - Format selection no longer triggers two `ctx.reply` calls.
    - Format selection creates a job with `payload.menuMessageId` equal to the original menu message id.
    - Menu/session state becomes progress and renders only `Назад` / `Отмена`.
    - Progress sessions remain cancellable past the normal menu TTL and are removed by terminal cleanup.
    - Shared progress renderer returns consistent byte-based text, progress bar, and reply markup for immediate, throttled, completed, failed, and cancelled update paths.
    - Progress renderer uses the expected total size when known, falls back to yt-dlp total/estimate when needed, and renders an unknown-total label instead of fabricating a total.
    - Progress-size formatting renders values below 1 MiB as `КБ`, values below 1 GiB as `МБ`, and larger values as `ГБ`, while existing menu option labels keep their current `formatTelegramBytes` behavior unless intentionally changed.
    - Duplicate callbacks while a job is starting/progressing answer with `telegramCopy.running` and do not enqueue additional jobs.
    - Stale root, container, quality, and audio callback data captured before progress started is rejected during `"starting"` / `"progress"` without navigating back to selectable formats and without enqueueing another job.
    - Progress keyboard `Назад` and `Отмена` callback data is actually routed by menu/callback handlers.
    - Progress keyboard markup does not contain orphan callback data outside the selected routing strategy.
    - `Назад` while progress is active does not cancel or navigate to selectable formats.
    - `Отмена` cancels queued/running jobs.
    - `TelegramDownloadProgressDispatcher` throttles `editMessageText` using an injected clock/time source.
    - `TelegramDownloadProgressDispatcher` keeps displayed downloaded bytes monotonic across repeated progress lines and stage resets.
    - Terminal suppression ignores delayed progress callbacks after completed, failed, and cancelled terminal cleanup paths.

  Files:
  - `src/adapters/telegram/menu-session-store.test.ts`
  - `src/adapters/telegram/copy.test.ts`
  - `src/adapters/telegram/menus/download-menu.test.ts`
  - `src/adapters/telegram/download-progress-dispatcher.test.ts`
  - `src/adapters/telegram/telegram-error.test.ts`

  Logging requirements:
  - Tests should assert important logger calls only where behavior depends on throttling, skipped updates, or swallowed Telegram edit errors.

- [x] Task 16: Add result-sender and server composition tests.

  Deliverable:
  - Add or update tests for:
    - Completion path uses `editMessageMedia` for MP4 with `menuMessageId`.
    - Successful `editMessageMedia` clears stale progress reply markup so completed media does not keep `Назад` / `Отмена`.
    - Non-MP4 or edit-media failure falls back to existing `sendVideo`/`sendDocument` behavior and updates/clears the original progress message.
    - Pre-upload rejection and final upload failure update the original progress message to a terminal failure state when possible.
    - Menu-backed terminal failures do not send duplicate failure notifications when the original progress message edit succeeds; they fall back to `sendMessage` only when the edit is unavailable or fails.
    - Server/adaptor composition exposes a testable progress cleanup contract without starting polling or webhook mode.
    - Dispatcher/session terminal cleanup clears per-job progress state on completed, failed, and cancelled jobs.
    - Shared Telegram error helper preserves existing redaction for quoted paths, unquoted paths with spaces, URLs, bot tokens, and token-like strings across result sender, dispatcher, and cleanup logs.

  Files:
  - `src/adapters/telegram/result-sender.test.ts`
  - `src/adapters/telegram/telegram-error.test.ts`
  - `src/server/server.test.ts`
  - `src/adapters/telegram/download-progress-dispatcher.test.ts`

  Logging requirements:
  - Tests should assert important logger calls only where behavior depends on fallback, final failure notification, or terminal cleanup.

- [ ] Task 17: Run verification gates and manual Telegram check.

  Deliverable:
  - Run `npm run test:core`.
  - Run `npm run backend:build`.
  - Manual Telegram check:
    - polling/webhook flow starts;
    - selecting quality updates the original message;
    - progress bar advances;
    - byte display advances as `downloaded / total`;
    - unknown-size fallback is acceptable only when neither metadata nor yt-dlp progress provides a total;
    - cancel stops queued/running work;
    - MP4 completion replaces the original message;
    - fallback media still reaches the chat.

  Files:
  - `package.json`
  - `tsconfig.backend.json`
  - Manual Telegram runtime/environment notes if any are needed locally

  Logging requirements:
  - Verification output should not require verbose logs to pass, but implementation should support DEBUG logs via existing `LOG_LEVEL`.

  Rework note 2026-05-13:
  - Automated gates passed after rework: `npm run backend:build`, `npm run test:core`.
  - Manual Telegram runtime check was not run in this environment, so Task 17 remains unchecked.

## Implementation Notes
- Do not introduce grammY, `@grammyjs/menu`, or Telegram Bot API imports into `src/core/**`.
- Keep `ctx.menu.update/nav/back/close` usage limited to callback/menu handlers. Worker progress and completion must use stored `chatId` and `payload.menuMessageId`.
- Prefer `yt-dlp --progress-template` with a unique prefix for progress parsing. The yt-dlp README recommends using structured output options such as `--progress-template` instead of parsing normal stdout for integrations.
- Prefer a small adapter helper for rendering progress keyboard so the dispatcher and immediate callback update cannot drift.
- Keep progress byte formatting centralized in `src/adapters/telegram/copy.ts`; do not hand-format `КБ` / `МБ` / `ГБ` strings in the dispatcher, and keep it separate from existing menu option byte labels unless those labels are intentionally migrated.
- Ensure progress reply markup uses registered `@grammyjs/menu` callback data or explicit callback-query handlers. Do not emit orphan callback data from dispatcher/result-sender helpers.
- Keep terminal cleanup behind a narrow server-composed adapter contract shared by dispatcher, result sender, and menu cancellation paths.
- Clearing dispatcher throttle state is not enough for terminal cleanup. Keep a short-lived terminal suppression record so delayed fire-and-forget progress callbacks cannot re-edit completed, failed, or cancelled messages.
- Preserve the menu session after job creation in a progress state; do not close/delete it until cancellation, expiration, or a terminal cleanup path.
- `editMessageMedia` can be constrained by Telegram rules and media type differences. Treat it as best-effort for MP4, not as the only delivery path.
- Preserve upload policy behavior from `TelegramResultSender`, including local Bot API mode and existing safe error redaction.
- Avoid logging local file paths, raw URLs, bot tokens, or full yt-dlp output.
