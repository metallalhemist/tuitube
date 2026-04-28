# Code Style And Conventions

Language and module style:
- TypeScript, NodeNext modules, ES2022 target, strict mode enabled.
- JSX uses `react-jsx`.
- Use UTF-8 and preserve the existing formatting style.

Naming:
- Files: lowercase or kebab-case for feature modules, e.g. `download-video.ts`, `extract-transcript.ts`, `utils.ts`.
- Variables and functions: camelCase.
- React components and TypeScript types: PascalCase.

Implementation conventions:
- Keep Termcast UI logic and AI tool input/output mapping thin where possible.
- Shared validation, executable lookup, path handling, format formatting, and title sanitization belong in shared helpers or future integration/core modules.
- Treat URLs and video titles as untrusted input; validate URLs and sanitize titles before creating file paths.
- External commands should be executed with argument arrays, e.g. `execa(binary, ["--dump-json", url])`, not shell-interpolated command strings.
- Surface user-facing failures through Termcast toasts/HUD/detail views or actionable thrown `Error` instances in tool handlers.
- Keep routine logging out of command flows; use diagnostics mainly for failure paths that also have user-facing feedback.

Architecture direction:
- Current code is small and root-level under `src/`; future work should migrate incrementally toward lightweight layers: `core/`, `integrations/`, `adapters/termcast/`, `adapters/telegram/`, `server/`, and `config/`.
- Core services must not import Termcast, React, grammY, Fastify, or Telegram-specific clients.