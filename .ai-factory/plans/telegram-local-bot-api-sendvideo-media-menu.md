# Implementation Plan: Telegram Local Bot API sendVideo And Media Menu Flow

Branch: feature/telegram-local-bot-api-sendvideo
Base branch: main
Created: 2026-05-01

## Settings

- [ ] Testing: yes
- [ ] Logging: verbose
- [ ] Docs: yes
- [ ] Scope: update the existing Telegram menu and result delivery flow so MP4 downloads are sent as Telegram videos with `supports_streaming: true` when eligible, large files are only advertised as sendable with Local Bot API mode, and audio/transcript actions are cleaned up without changing Termcast tools or core transcript services.
- [ ] Branch handling: branch creation was deferred during initial planning because the working copy was treated as potentially dirty. Preserve the plan and references on `main` first, then create `feature/telegram-local-bot-api-sendvideo` from that commit.

## Research Context

Source: `.ai-factory/RESEARCH.md` Active Summary, superseded by this request where it conflicts.

Goal:
- Keep URL -> acknowledgement -> metadata/options -> Russian Telegram menu -> queued background job -> result send flow.
- Redesign the menu around MP4 video options, other video containers, and a separate audio menu.
- Preserve architecture boundaries: pure/core selectors may live in `src/core/format-selection.ts`; grammY/menu/send behavior stays in `src/adapters/telegram`; server config stays in `src/server`.

Constraints:
- Do not run downloads, metadata, transcript extraction, upload, `ffprobe`, transcode, or recode inside the webhook lifecycle.
- Do not introduce `--recode-video` or default transcoding. Keep current yt-dlp merge/download behavior.
- Keep `TELEGRAM_API_ROOT` as the env name and pass grammY the root URL without `/bot<TOKEN>`, for example `http://127.0.0.1:18081`.
- Treat `MAX_FILE_SIZE_MB` as operational server download policy, separate from Telegram upload limits.
- Official cloud Bot API upload support is 50 MB; Local Bot API upload support is 2000 MB. Files above 50 MB must not be shown or promised as Telegram-sendable unless `TELEGRAM_API_ROOT` enables Local Bot API mode.
- V1 Telegram video eligibility is based on the actual downloaded output extension being `.mp4`; WEBM/VP9/OPUS remains document delivery.
- Core must not import grammY, Fastify, Termcast, React, or `@grammyjs/menu`.

External source check:
- Telegram Bot API docs confirm Local Bot API can upload files up to 2000 MB and supports local path/file URI uploads: https://core.telegram.org/bots/api#using-a-local-bot-api-server
- Telegram Bot Features docs list Official upload 50 MB and Local upload 2000 MB, and note `logOut` before redirecting to a local API URL: https://core.telegram.org/bots/features#local-bot-api
- Telegram Bot API docs expose `supports_streaming` for video uploads: https://core.telegram.org/bots/api#sendvideo

Open questions:
- Whether to attempt Local Bot API local-path/file-URI upload in this iteration. Default implementation should stay safe by using `InputFile` unless an explicit deployment flag or later smoke test proves the Bot API server sees the same absolute paths through Docker mounts.
- Whether to remove legacy `extract_mp3` and `extract_transcript` `MediaJobAction` values immediately, or leave them as compatibility-only worker cases with no Telegram menu entry.

## Commit Plan

- [ ] **Commit 1** (after tasks 1-3): `feat: add telegram upload policy and video sender`
- [ ] **Commit 2** (after tasks 4-7): `feat: redesign telegram media menus`
- [ ] **Commit 3** (after tasks 8-10): `test: cover telegram media menu and upload limits`
- [ ] **Commit 4** (after tasks 11-12): `docs: document local bot api media delivery`

## Tasks

### Phase 1: Upload Mode And Result Sending

- [ ] Task 1: Add Telegram upload mode configuration helpers.
  - [ ] Deliverable: represent Telegram upload limits derived from `TELEGRAM_API_ROOT` without adding a second env var such as `TELEGRAM_BOT_API_URL`.
  - [ ] Expected behavior: `loadServerConfig` still parses `telegram.apiRoot` from `TELEGRAM_API_ROOT`; add adapter-safe helpers/constants such as cloud limit `50 MB`, local limit `2000 MB`, `isLocalBotApiMode`, and `telegramUploadLimitBytes`. grammY still receives root URL only, with no `/bot<TOKEN>` suffix. `MAX_FILE_SIZE_MB` remains server-side download policy and does not mean Telegram can send the file.
  - [ ] Files: `src/server/config.ts`, `src/server/server.test.ts`, optionally `src/adapters/telegram/upload-limits.ts`.
  - [ ] Logging requirements: log local API mode enabled/disabled at startup as today, but never log bot tokens, full Bot API method URLs, or secret-bearing URLs.
  - [ ] Dependencies: none.

- [ ] Task 2: Extend `TelegramResultSender` to choose `sendVideo` for actual `.mp4` outputs.
  - [ ] Deliverable: extend `TelegramResultApi` with `sendVideo`, stat the downloaded file, enforce upload limits, and route `.mp4` files through `sendVideo`.
  - [ ] Expected behavior: before any upload, call `fs.stat` on `result.filePath`; reject over-limit files with Russian user copy before uploading. If the actual output extension is `.mp4`, call `sendVideo(chatId, file, { caption, supports_streaming: true })`; otherwise call `sendDocument`. WEBM and other non-MP4 files must not use `sendVideo`. Use `InputFile(result.filePath)` as the safe fallback for both cloud and local modes. Do not add ffprobe as a required gate in V1.
  - [ ] Files: `src/adapters/telegram/result-sender.ts`, `src/adapters/telegram/copy.ts`, `src/adapters/telegram/result-sender.test.ts`.
  - [ ] Logging requirements: log send start/finish at `INFO` with job id/action/media kind/local mode/size bucket; log actual byte limit decisions at `DEBUG`; log Telegram upload failures at `ERROR` with sanitized error text only. Do not log full paths if they may contain secrets, file contents, raw URLs, or tokens.
  - [ ] Dependencies: task 1.

- [ ] Task 3: Map Telegram upload failures to readable Russian messages.
  - [ ] Deliverable: add error classification for 413, `Request Entity Too Large`, and `file is too big` from grammY/Telegram responses.
  - [ ] Expected behavior: users get a clear message explaining that the file is too large for the current Telegram API mode and should select a smaller quality or configure Local Bot API for large MP4 delivery. Keep generic send failures mapped to the existing send-failed copy. Re-throw after notifying so worker/job failure state stays accurate.
  - [ ] Files: `src/adapters/telegram/result-sender.ts`, `src/adapters/telegram/copy.ts`, `src/adapters/telegram/result-sender.test.ts`.
  - [ ] Logging requirements: log mapped too-large failures at `WARN` with reason code and upload mode; log unexpected API failures at `ERROR` with sanitized message and status code only.
  - [ ] Dependencies: task 2.

### Phase 2: Pure Format Selectors And Menu State

- [ ] Task 4: Add pure format selectors for the new Telegram menu model.
  - [ ] Deliverable: add deterministic selectors for root MP4 video options, video containers excluding audio, video qualities by container, and audio-only options.
  - [ ] Expected behavior: root MP4 selectors return only MP4 video options, not audio. Other-format containers show video containers such as WEBM, exclude audio-only options, and exclude MP4 when MP4 already appears on the root screen. If no MP4 is shown on root, MP4 remains available under Other Formats as fallback. WEBM video container labels must be `WEBM`, never `WEBM Audio`. Audio selectors include M4A, OPUS/WEBM audio, and the synthetic MP3/Best option supported by `MP3_FORMAT_ID`.
  - [ ] Files: `src/core/format-selection.ts`, `src/core/helpers.test.ts`.
  - [ ] Logging requirements: pure selectors must not log; callers log selected counts/reasons at the adapter boundary.
  - [ ] Dependencies: none.

- [ ] Task 5: Update Telegram button labeling and row layout helpers.
  - [ ] Deliverable: adjust label helpers so unknown sizes omit size text, known sizes render like `720p · 42.3 МиБ`, and rows use two buttons only for short labels.
  - [ ] Expected behavior: button text never contains `неизвестный размер`; unknown-size video buttons show only quality/container label. Long labels use one button per row. MP4 root buttons are rendered two per row when labels are short enough. Container buttons use container labels such as `WEBM`; audio format buttons show audio format labels such as `M4A`, `OPUS`, `WEBM Audio`, and `MP3`.
  - [ ] Files: `src/adapters/telegram/copy.ts`, `src/adapters/telegram/menus/download-menu.ts`, `src/adapters/telegram/menus/format-menu.ts`, `src/adapters/telegram/menus/download-menu.test.ts`, `src/adapters/telegram/copy.test.ts`.
  - [ ] Logging requirements: no logging in pure copy helpers; menu render code logs button counts and one-vs-two-column layout decisions at `DEBUG`.
  - [ ] Dependencies: task 4.

- [ ] Task 6: Redesign the root Telegram menu.
  - [ ] Deliverable: replace root action buttons with MP4 video options, `Другие форматы`, `Извлечь аудио`, and `Отмена`.
  - [ ] Expected behavior: root menu no longer contains `Извлечь MP3` or `Извлечь расшифровку`. Root MP4 options enqueue `download_format` with the selected `formatValue`. `Другие форматы` is always on a separate row and opens the video-container menu. `Извлечь аудио` is on a separate row and opens the audio menu. `Отмена` remains available. Disabled options answer callbacks without enqueueing work.
  - [ ] Files: `src/adapters/telegram/menus/download-menu.ts`, `src/adapters/telegram/menus/menu-state.ts`, `src/adapters/telegram/copy.ts`, `src/server/index.ts`.
  - [ ] Logging requirements: log root render/action at `DEBUG` with session key, option id/action, disabled state, and reason code. Do not log raw URLs.
  - [ ] Dependencies: tasks 4 and 5.

- [ ] Task 7: Redesign Other Formats and add Audio menu navigation.
  - [ ] Deliverable: split existing container/quality menu into video-container quality selection and audio-only selection.
  - [ ] Expected behavior: Other Formats lists only video containers; it does not list audio containers/options. If MP4 is already on root, Other Formats excludes MP4; otherwise it may include MP4 fallback. Selecting a video container shows qualities for that container, two per row where labels are short, plus `Назад`. Audio menu lists only audio-only options including M4A, OPUS/WEBM audio, and MP3/Best where available; selecting any audio option enqueues `download_format` with that option's `formatValue`, including `MP3_FORMAT_ID` for MP3. Transcript extraction is not available from this menu flow.
  - [ ] Files: `src/adapters/telegram/menus/download-menu.ts`, `src/adapters/telegram/menus/format-menu.ts`, `src/adapters/telegram/menus/menu-state.ts`, `src/adapters/telegram/menu-session-store.ts`, `src/adapters/telegram/copy.ts`, `src/server/index.ts`.
  - [ ] Logging requirements: log submenu navigation and selected container/audio format at `DEBUG`; log expired/missing sessions at `WARN`; never log raw URLs, bot tokens, or full file paths.
  - [ ] Dependencies: tasks 4, 5, and 6.

### Phase 3: Job/Action Cleanup

- [ ] Task 8: Remove Telegram menu usage of transcript and root MP3 actions.
  - [ ] Deliverable: stop using `extract_transcript` and `extract_mp3` from Telegram menu handlers while leaving `TranscriptService`, `src/transcript.ts`, and Termcast tools untouched.
  - [ ] Expected behavior: Telegram menu can no longer enqueue transcript jobs. MP3 downloads go through `download_format` with `MP3_FORMAT_ID`. Decide during implementation whether legacy `MediaJobAction` values remain worker-compatible for old queued jobs/tests or are removed in a separate cleanup commit. If retained, mark them as compatibility-only and keep them out of Telegram UI types.
  - [ ] Files: `src/adapters/telegram/menus/download-menu.ts`, `src/server/index.ts`, `src/core/jobs/queue.ts`, `src/core/jobs/download-worker.ts`, `src/core/jobs/jobs.test.ts`.
  - [ ] Logging requirements: log compatibility fallback use at `WARN` if legacy actions remain reachable outside the new menu; normal audio downloads log as `download_format`.
  - [ ] Dependencies: tasks 6 and 7.

- [ ] Task 9: Align metadata dispatch and display policy with upload limits.
  - [ ] Deliverable: ensure menu presentation does not imply cloud Bot API can send files over 50 MB.
  - [ ] Expected behavior: when `TELEGRAM_API_ROOT` is unset, MP4/video options whose estimated size exceeds cloud upload limit are disabled or clearly marked as unavailable for Telegram send; when local mode is enabled, the display limit is 2000 MB. Unknown sizes may remain selectable only if current server policy allows them, but copy must not promise deliverability. Keep `too_large` vs server/download policy distinctions clear.
  - [ ] Files: `src/adapters/telegram/telegram-policy.ts`, `src/adapters/telegram/metadata-result-dispatcher.ts`, `src/adapters/telegram/copy.ts`, `src/server/index.ts`, `src/adapters/telegram/metadata-result-dispatcher.test.ts`.
  - [ ] Logging requirements: log menu upload-limit policy decisions at `DEBUG` with upload mode, limit, option id, and reason code; do not log raw URLs.
  - [ ] Dependencies: tasks 1, 4, and 6.

### Phase 4: Tests And Verification

- [ ] Task 10: Add focused unit coverage for menu selectors, labels, and navigation.
  - [ ] Deliverable: cover the new root, Other Formats, Audio menu, and pure selector behavior.
  - [ ] Expected behavior: tests assert root menu does not contain `Извлечь MP3` or `Извлечь расшифровку`; root contains `Извлечь аудио`; root MP4 options are two per row when labels are short; Other Formats excludes audio and excludes MP4 when root has MP4; Other Formats includes WEBM video as `WEBM`; WEBM video is not labeled `WEBM Audio`; Audio menu contains M4A/OPUS/MP3 options; unknown-size labels do not contain `неизвестный размер`.
  - [ ] Files: `src/core/helpers.test.ts`, `src/adapters/telegram/menus/download-menu.test.ts`, `src/adapters/telegram/copy.test.ts`.
  - [ ] Logging requirements: tests should use stub loggers and assert key warning paths without snapshotting noisy or sensitive payloads.
  - [ ] Dependencies: tasks 4-7.

- [ ] Task 11: Add result-sender and config tests for upload limits and sendVideo.
  - [ ] Deliverable: cover MP4/video delivery, non-MP4 document fallback, stat-based size enforcement, and Telegram API error mapping.
  - [ ] Expected behavior: `.mp4` calls `sendVideo` with `supports_streaming: true`; WEBM and non-MP4 call `sendDocument`; cloud mode rejects actual files over 50 MB with readable Russian copy; local mode allows files up to 2000 MB; 413/Request Entity Too Large/file-is-too-big maps to the readable too-large send failure copy; config tests verify `TELEGRAM_API_ROOT` local mode and upload limit selection.
  - [ ] Files: `src/adapters/telegram/result-sender.test.ts`, `src/server/server.test.ts`, optional `src/adapters/telegram/upload-limits.test.ts`.
  - [ ] Logging requirements: tests should assert logs contain reason codes but not full file paths, tokens, raw URLs, or file contents.
  - [ ] Dependencies: tasks 1-3 and 9.

- [ ] Task 12: Run quality gates and update docs/deploy notes.
  - [ ] Deliverable: run verification, update docs, and write deployment/smoke/rollback notes.
  - [ ] Expected behavior: `npm run backend:build` and `npm run test:core` pass. Attempt `npm run build` if the local environment supports the required Termcast/Bun toolchain, and report any environment-only blocker. README/docs describe `TELEGRAM_API_ROOT=http://127.0.0.1:18081`, root URL without `/bot<TOKEN>`, cloud 50 MB vs local 2000 MB upload limits, `MAX_FILE_SIZE_MB` as operational download policy, Local Bot API requirement for files over 50 MB, Docker mount caveat for local paths/file URI, PM2 deployment, smoke tests for small MP4, >50 MB MP4 with local API, WEBM, and audio option, plus rollback by removing `TELEGRAM_API_ROOT` and using Telegram `logOut`/migration handling as appropriate. Deployment instructions must not touch other PM2 processes and should restart only `tuitube-bot` with `pm2 restart tuitube-bot --update-env`.
  - [ ] Files: `README.md`, optional `docs/*`, touched source/test files only.
  - [ ] Logging requirements: docs should explain `LOG_LEVEL=debug` for diagnostics and repeat that logs must not contain bot tokens, secret URLs, raw user URLs, full file paths with secrets, or file contents.
  - [ ] Dependencies: tasks 1-11.

## Quality Gates

- [ ] Boundary check: `src/core` imports no grammY, Fastify, Termcast, React, or `@grammyjs/menu`.
- [ ] No recode/transcode check: `downloadFormatArgs` still never emits `--recode-video`, and implementation does not add automatic ffmpeg transcoding.
- [ ] Upload-limit check: files over 50 MB are considered Telegram-sendable only when `TELEGRAM_API_ROOT` enables Local Bot API mode; local mode still caps sends at 2000 MB.
- [ ] Result-sender check: actual file size is checked with `fs.stat` before upload; `.mp4` uses `sendVideo` with `supports_streaming: true`; non-MP4 uses `sendDocument`.
- [ ] Menu check: root shows MP4 video options, `Другие форматы`, `Извлечь аудио`, and `Отмена`; root does not show `Извлечь MP3` or `Извлечь расшифровку`.
- [ ] Other Formats check: video containers only; no audio-only entries; MP4 exclusion/fallback behavior matches root MP4 availability; WEBM video is labeled `WEBM`.
- [ ] Audio check: audio menu contains audio-only M4A/OPUS/WEBM audio/MP3 options and enqueues `download_format` with the selected `formatValue`.
- [ ] Copy check: unknown-size button labels omit `неизвестный размер`; known sizes render quality/container plus MiB/GiB.
- [ ] Secret/log check: no bot tokens, webhook secrets, raw Bot API URLs, raw user URLs, file contents, transcript contents, or risky full paths are logged.
- [ ] Verification commands: `npm run backend:build`, `npm run test:core`, and `npm run build` when local dependencies are available.

## Implementation Notes

- Prefer adding selector functions in `src/core/format-selection.ts` because they are pure and already own format grouping. Keep all row layout, Russian copy, callback handling, and send behavior inside `src/adapters/telegram`.
- Treat Local Bot API local path/file URI upload as an optimization, not the default. In Docker, both the bot process and Bot API server must see the same absolute path; if that is not guaranteed, `InputFile` streaming is the safer default.
- Keep `TELEGRAM_API_ROOT` as the single public env knob. Do not add `TELEGRAM_BOT_API_URL` unless implementation discovers a concrete incompatibility that cannot be solved by documenting `apiRoot` root URL semantics.
- Optional future enhancement: add `ffprobe` validation for MP4 container/codecs before `sendVideo`, but do not make it a V1 gate and do not transcode failed probes automatically.
