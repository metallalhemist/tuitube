# Research

Updated: 2026-04-29 09:48
Status: active

## Active Summary (input for $aif-plan)
<!-- aif:active-summary:start -->
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
- File size policy for Telegram UI: show `too_large` only when the expected output file size is strictly greater than 2 GiB. Unknown size must be represented separately as `unknown_size`, not as too large.
- Russian bot copy is required for all user-facing Telegram messages and buttons.

Decisions:
- Main interaction shape: URL -> quick Russian acknowledgement -> metadata/options lookup -> menu -> user action -> job enqueue -> worker completion -> send file or error message.
- The first menu should offer: best video download, choose quality, MP3, transcript, cancel.
- Format selection should use dynamic menu entries from `SerializableFormatOption`.
- Transcript should be a separate action from download format selection.
- Long transcript output should be sent as a `.md` or `.txt` document instead of one oversized Telegram message.

Open questions:
- Whether transcript extraction should be queued through the same job system immediately or added as a second job type later.
- Whether session expiration should be a fixed short TTL, for example 15 minutes, or configurable.
- Whether to display queue position in the first version or only return the created job id.
- Whether completed files should be sent through grammY directly in the worker callback or via a dedicated Telegram file sender adapter.

Success signals:
- A user can send a URL, choose an action from a Russian menu, and receive a queued/running/completed/failure message without blocking the webhook.
- Disabled/limited formats are clearly explained, with `too_large` used only for files over 2 GiB.
- Core services remain UI-agnostic and do not import grammY, Fastify, Termcast, or `@grammyjs/menu`.

Next step:
- Run `$aif-plan` to turn this research into implementation tasks for the Telegram menu UI.
<!-- aif:active-summary:end -->

## Sessions
<!-- aif:sessions:start -->
### 2026-04-29 09:48 - Telegram bot UI flow for $aif-plan

What changed:
- Captured the desired Telegram bot flow for a future `$aif-plan`.
- Added two explicit product constraints from the user:
  - Telegram bot text must be in Russian.
  - A file is `too_large` only if the expected output size is strictly greater than 2 GiB.

Key notes:

```text
/start
  |
  v
"Пришли ссылку на видео."
  |
  v
User sends URL
  |
  v
"Проверяю ссылку..."
  |
  v
metadata + format options
  |
  v
Main video menu
```

Recommended main menu:

```text
<video title>
Длительность: 12:34

[Скачать лучшее качество]
[Выбрать качество]
[Скачать MP3]
[Получить транскрипт]
[Отмена]
```

Recommended quality menu:

```text
Выбери качество:

[1080p mp4 1.4 ГБ]
[720p mp4 820 МБ]
[480p mp4 420 МБ]
[MP3 audio]

[Назад] [Отмена]
```

Recommended state model:

```text
[idle]
  |
  | URL
  v
[analyzing_url] -- invalid --> [idle]
  |
  v
[awaiting_action]
  |        |          |
  |        |          +--> transcript
  |        +--> choose_format --> [awaiting_format]
  |                              |
  +--> best/mp3 -----------------+
                                 v
                              [queued]
                                 |
                                 v
                              [running]
                            /    |     \
                           v     v      v
                    [completed] [failed] [cancelled]
```

Russian copy candidates:

```text
/start:
Привет. Пришли ссылку на видео, и я помогу скачать его, MP3 или транскрипт.

Invalid URL:
Не похоже на ссылку на видео. Пришли корректную ссылку.

Analyzing URL:
Проверяю ссылку...

Metadata failure:
Не удалось получить информацию о видео. Попробуй другую ссылку или повтори позже.

Main menu intro:
Нашел видео:
<title>
Длительность: <duration>

Choose action:
Что сделать?

Queue accepted:
Добавил в очередь: <jobId>.

Queue full:
Очередь скачивания заполнена. Попробуй позже.

Download running:
Скачиваю видео...

Download completed:
Готово.

Download failed:
Не удалось скачать файл. Попробуй позже или выбери другое качество.

Cancelled:
Отменил.

Too large:
Файл больше 2 ГБ. Выбери качество ниже или MP3.

Unknown size:
Не удалось заранее определить размер файла. Можно попробовать скачать, но файл может оказаться большим.

Transcript running:
Извлекаю транскрипт...

Transcript missing:
Не нашел доступные субтитры для этого видео.
```

Policy detail for planning:
- `too_large` must mean `expectedSizeBytes > 2 * 1024 * 1024 * 1024`.
- `expectedSizeBytes <= 2 GiB` must not be shown as too large in Telegram UI.
- Missing or unknown size must use a separate `unknown_size` state/copy.
- If core policy currently uses a lower default limit for small-server safety, the plan should explicitly decide whether Telegram UI needs a separate display threshold, a config override, or an updated policy default.

Architecture notes:
- Current Telegram adapter is minimal: URL text is validated and immediately queued in `src/adapters/telegram/bot.ts`.
- Future menu UI should live under the Telegram adapter layer, for example `src/adapters/telegram/menus/`.
- Format data should come from `VideoDownloadService.getFormatOptions`.
- Job enqueue should continue through `JobService.createDownloadJob`.
- Worker completion should send files/messages without storing permanent downloads on the server.
- Webhook registration must include `callback_query` once menu callbacks exist.

Links (paths):
- `src/adapters/telegram/bot.ts`
- `src/core/services/video-download-service.ts`
- `src/core/format-selection.ts`
- `src/core/jobs/job-service.ts`
- `src/core/jobs/download-worker.ts`
- `src/server/index.ts`
<!-- aif:sessions:end -->
