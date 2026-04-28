# Project Overview

Tuitube is a Termcast extension for downloading videos from YouTube, X, Twitch, Instagram, Bilibili, and other sites supported by `yt-dlp`. It also exposes Termcast AI tool handlers for downloading a video and extracting cleaned video transcripts/subtitles.

Tech stack:
- TypeScript with Node.js ES modules (`type: module`).
- React 19 JSX views running inside Termcast.
- External command integration with `yt-dlp`, `ffmpeg`, `ffprobe`, Homebrew, and winget.
- Libraries include `execa`, `validator`, `date-fns`, `pretty-bytes`, and `srt-parser-2`.
- No database or ORM.

Current source structure:
- `src/index.tsx`: main interactive Termcast command UI.
- `src/tools/download-video.ts`: AI tool for video downloads.
- `src/tools/extract-transcript.ts`: AI tool for transcript extraction.
- `src/transcript.ts`: subtitle download, conversion, parsing, cleanup, and temp-file cleanup.
- `src/types.ts`: shared yt-dlp metadata types.
- `src/utils.ts`: executable lookup, URL/time validation, format formatting, title sanitization, and shared path helpers.
- `src/views/installer.tsx` and `src/views/updater.tsx`: Termcast support views.

Project context docs:
- `AGENTS.md`: agent map and rules.
- `.ai-factory/DESCRIPTION.md`: stack and feature summary.
- `.ai-factory/ARCHITECTURE.md`: target lightweight layered architecture.
- `.ai-factory/rules/base.md`: detected code conventions.