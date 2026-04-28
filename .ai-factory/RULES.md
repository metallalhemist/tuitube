# Project Rules

> Short, actionable rules and conventions for this project. Loaded automatically by $aif-implement.

## Rules

- Core layer must not import grammY, Fastify, Termcast, `@grammyjs/menu`, or any UI-specific APIs.
- Telegram and Fastify code must act as adapter layers that receive updates, call services, and send results.
- Download and transcript logic must live in reusable services or core modules callable from both Termcast and Telegram.
- Webhook handlers must not run long download jobs inside the HTTP request lifecycle.
- Webhook handlers must acknowledge updates quickly and hand work off to a job or service layer.
- Use simple in-memory job orchestration until Redis or BullMQ is introduced.
- Design job orchestration boundaries so the in-memory queue can later be replaced by a persistent queue.
- Read and validate all environment variables centrally in a config module.
- Do not read `process.env` directly across feature modules.
- Keep `TELEGRAM_API_ROOT` optional and use it for Local Telegram Bot API Server support.
- Do not hardcode Telegram integration to only `https://api.telegram.org`.
- Run external commands only with argument arrays such as `execa(file, args)` or `spawn(file, args)`.
- Never use shell interpolation for external command execution.
- Each download job must use its own temporary directory inside `DOWNLOAD_DIR`.
- Clean up temporary files in `finally` after successful sending or after errors.
- Do not permanently store downloaded videos on the server without an explicit product requirement.
- Core and service errors must be structured and machine-readable.
- User-facing error text must be generated in the adapter or UI layer.
- Never log bot tokens, webhook secrets, full `TELEGRAM_WEBHOOK_URL` values with secrets, or other sensitive values.
- Preserve current Termcast functionality when extracting shared logic.
- Keep format selection and file size policy as pure functions testable without `yt-dlp`.
- Treat Local Telegram Bot API Server as the production path for large files.
- Treat the official Telegram Bot API as the development or small-file mode.
- For a 1 vCPU, 2 GB RAM, 30 GB disk server, default to `MAX_CONCURRENT_DOWNLOADS=1`, `MAX_QUEUE_SIZE=5`, `MAX_FILE_SIZE_MB=1200`, and `MIN_FREE_DISK_MB=6000`.
- Do not claim support for 2 GB uploads on a small server without real disk, network, and Local Bot API Server testing.
- Check free disk space before starting a download job.
- Check expected file size before starting a download job when metadata provides it.
- If exact format size is unknown, return an explicit `unknown_size` state instead of pretending the size is known.
- Backend services must obtain metadata with `yt-dlp --dump-json` and build available format options before downloading.
- Format options must include resolution, extension, format id, estimated size, disabled state, and a machine-readable reason.
- For YouTube video-only formats, pair video format with best audio and compute size as video plus audio when both sizes are known.
- Do not add database, Redis, Docker, CI, or deploy config in the backend-foundation task unless needed for the current stage.
- Build the future Telegram bot UI layer on the official grammY menu plugin, `@grammyjs/menu`.
- Do not use manually assembled inline keyboards for primary user flows when the same flow can be expressed with `Menu`.
- Design video format selection, back navigation, reselection, MP3, transcript, and cancel flows as menu-based flows.
- Keep `@grammyjs/menu` dependencies out of backend and core layers.
- Use `@grammyjs/menu` only in the Telegram adapter or UI layer.
- Use stable string menu identifiers that do not contain user-specific or secret data.
- Use dynamic labels or ranges from the menu plugin for dynamic format buttons.
- Fetch format data for dynamic menu buttons from backend services.
- Include `callback_query` whenever custom `allowed_updates` is configured.
- Register menus before middleware that handles callback query data.
- Use `submenu`, `back`, and registered nested menus for multi-page flows instead of manual callback data routing.
- Handle outdated menus and button updates with menu plugin APIs such as `ctx.menu.update()`, `ctx.menu.nav()`, `ctx.menu.back()`, and `onMenuOutdated` where appropriate.
- Do not implement the UI or menu layer in the backend-foundation task.
- Leave architectural extension points for adding the Telegram menu layer later in the backend-foundation task.
