# AGENTS.md

> Keep this file updated when the project structure changes significantly. It is a quick map for AI agents and contributors.

## Project Overview

Tuitube is a Termcast extension and Telegram backend foundation for downloading videos with `yt-dlp` and extracting transcripts through reusable core services.

## Tech Stack

- **Programming language:** TypeScript
- **Runtime:** Node.js with ES modules
- **Framework:** Termcast with React 19, Fastify, grammY
- **Database:** None
- **ORM:** None

## Project Structure

```text
.
├── assets/                 # Extension icon assets
├── metadata/               # Store/listing media
├── src/                    # TypeScript source
│   ├── tools/              # Termcast AI tool handlers
│   ├── views/              # Termcast React support views
│   ├── core/               # Backend-safe services, policy, jobs, validation, logging
│   ├── integrations/       # External command and filesystem adapters
│   ├── adapters/telegram/  # grammY bot, Russian copy, menu UI, sessions, result senders
│   ├── server/             # Fastify app, env config, lifecycle, backend entrypoint
│   ├── index.tsx           # Main interactive command
│   ├── transcript.ts       # Subtitle download and transcript cleanup
│   ├── types.ts            # Shared yt-dlp metadata types
│   └── utils.ts            # Shared validation, paths, formats, sanitization
├── .ai-factory/            # AI Factory project context
├── package.json            # Termcast package manifest, preferences, scripts
├── tsconfig.json           # TypeScript strict-mode configuration
└── eslint.config.mjs       # ESLint configuration
```

## Key Entry Points

| File                                          | Purpose                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/index.tsx`                               | Main Termcast command UI for video download.                                              |
| `src/tools/download-video.ts`                 | AI tool that downloads a video and returns file metadata.                                 |
| `src/tools/extract-transcript.ts`             | AI tool that returns a cleaned transcript for a video URL.                                |
| `src/transcript.ts`                           | Subtitle download, conversion, parsing, cleanup, and temporary-file cleanup.              |
| `src/core/services/video-download-service.ts` | Reusable metadata, policy, format, temp-dir, and download orchestration.                  |
| `src/core/services/transcript-service.ts`     | Reusable transcript extraction and temporary subtitle cleanup.                            |
| `src/core/jobs/job-service.ts`                | In-memory job creation and state tracking boundary.                                       |
| `src/server/config.ts`                        | Central backend environment parsing and validation.                                       |
| `src/server/app.ts`                           | Side-effect-light Fastify app factory for health and Telegram webhook routes.             |
| `src/server/index.ts`                         | Backend process entrypoint for startup, webhook registration, and shutdown.               |
| `src/adapters/telegram/bot.ts`                | Minimal grammY bot wiring and queue handoff.                                              |
| `src/adapters/telegram/menus/download-menu.ts`| Telegram root menu for best video, quality, MP3, transcript, and cancellation actions.     |
| `src/adapters/telegram/menu-session-store.ts` | In-memory Telegram menu session storage with 15 minute TTL.                               |
| `src/adapters/telegram/metadata-result-dispatcher.ts` | Sends prepared metadata menus after background snapshot jobs complete.          |
| `src/adapters/telegram/result-sender.ts`      | Sends completed media/transcript results back to Telegram and cleans temporary documents.  |
| `src/utils.ts`                                | Shared executable lookup, URL/time validation, format formatting, and title sanitization. |
| `package.json`                                | Package metadata, commands, tools, preferences, scripts, and AI evals.                    |

## Documentation

| Document            | Path                          | Description                                                        |
| ------------------- | ----------------------------- | ------------------------------------------------------------------ |
| README              | `README.md`                   | Installation and usage notes for Tuitube.                          |
| Changelog           | `CHANGELOG.md`                | Release history.                                                   |
| Project description | `.ai-factory/DESCRIPTION.md`  | AI Factory summary of stack, features, patterns, and requirements. |
| Architecture        | `.ai-factory/ARCHITECTURE.md` | Architecture guidelines and dependency rules.                      |

## AI Context Files

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `AGENTS.md`                   | Repository map and agent guidance.                                 |
| `.ai-factory/config.yaml`     | AI Factory language, path, workflow, git, and rules configuration. |
| `.ai-factory/DESCRIPTION.md`  | Project description used by AI Factory skills.                     |
| `.ai-factory/ARCHITECTURE.md` | Architecture guidelines for future changes.                        |
| `.ai-factory/rules/base.md`   | Auto-detected project coding conventions.                          |

## Agent Rules

- Keep shell commands decomposed when state changes matter.
- Incorrect combined command: `git checkout main && git pull`
- Correct sequence: first `git checkout main`, then `git pull origin main`.
- Do not implement features from `$aif`; use `$aif-plan` and `$aif-implement` for implementation work.
