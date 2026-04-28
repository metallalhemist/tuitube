# Tuitube Project Description

## Overview

Tuitube is a Termcast extension that provides a text UI for downloading videos from YouTube, X, Twitch, Instagram, Bilibili, and other sites supported by `yt-dlp`. It also exposes AI tools for downloading videos and extracting video transcripts.

The project is an existing TypeScript package with a React-based Termcast command UI, command-line integration through `yt-dlp`, `ffmpeg`, `ffprobe`, Homebrew, and winget, and utility modules for format selection, path detection, transcript extraction, and file-name sanitization.

## Core Features

- Download videos through an interactive Termcast form.
- Select video, audio-only, and MP3 download formats from `yt-dlp` metadata.
- Show download progress and final file actions through Termcast toasts.
- Auto-detect or install required external executables on macOS and Windows.
- Extract subtitles through `yt-dlp`, convert them to SRT, and clean transcript text.
- Provide Termcast AI tools for video download and transcript extraction.
- Expose a Fastify health route and Telegram webhook route.
- Queue Telegram download work in memory so webhook requests do not run long external commands inline.

## Tech Stack

- **Programming language:** TypeScript
- **Runtime:** Node.js with ES modules
- **Framework:** Termcast with React 19 JSX views; Fastify and grammY for the Telegram webhook backend
- **CLI/process integration:** `execa`, `node:child_process`, `yt-dlp`, `ffmpeg`, `ffprobe`, Homebrew, winget
- **Validation and formatting:** `validator`, `date-fns`, `pretty-bytes`, `srt-parser-2`
- **Build tooling:** `termcast build`, `termcast dev`, backend TypeScript compilation with `tsconfig.backend.json`, `tsx` for backend dev
- **Testing:** Vitest for focused backend/core tests
- **Static analysis:** TypeScript strict mode, ESLint recommended TypeScript config, Prettier
- **Database:** None
- **ORM:** None

## Identified Patterns

- Source files live under `src/`.
- The default command entry point is `src/index.tsx`.
- AI tool handlers live under `src/tools/`.
- UI support views live under `src/views/`.
- Cross-cutting executable detection, validation, format handling, and sanitization live in `src/utils.ts`.
- Shared `yt-dlp` metadata types live in `src/types.ts`.
- Backend-safe core services live under `src/core/`.
- External command and filesystem adapters live under `src/integrations/`.
- grammY adapter code lives under `src/adapters/telegram/`.
- Fastify config, app factory, lifecycle, and process startup live under `src/server/`.
- Functions and variables use camelCase, React components use PascalCase, and file names use kebab-case where modules are feature-oriented.

## Architecture

Detailed architecture guidelines are in `.ai-factory/ARCHITECTURE.md`.

**Pattern:** Layered Architecture

## Architecture Notes

This project is small and integration-heavy, but it is expected to support both the current Termcast adapter and a future Telegram backend on grammY with Fastify webhooks. The useful boundary is between reusable core download/transcript/job services, low-level integrations for external commands and filesystem work, transport-specific adapters, and server lifecycle code. Keep the layered design lightweight, but do not let Termcast, grammY, Fastify, or `@grammyjs/menu` leak into core services.

## Non-Functional Requirements

- **Error handling:** Surface user-facing failures through Termcast toasts or thrown tool errors with actionable messages.
- **Logging:** Keep console logging limited to diagnostic failure paths where the user also receives feedback.
- **Security:** Treat video URLs and downloaded file names as untrusted input. Continue validating URLs and sanitizing output titles before building file paths.
- **Portability:** Preserve macOS and Windows behavior when changing executable detection, installation, or path handling.
- **Performance:** Avoid repeated expensive CLI calls when cached data or existing state is available.
