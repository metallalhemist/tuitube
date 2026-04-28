# Project Base Rules

> Auto-detected conventions from codebase analysis. Edit as needed.

## Naming Conventions

- Files: feature and utility modules use lowercase or kebab-case names, such as `download-video.ts`, `extract-transcript.ts`, and `utils.ts`.
- Variables: use camelCase for local variables, constants that are not exported sentinel values, and object properties.
- Functions: use camelCase for utility functions and exported tool helpers.
- Classes: no project-defined classes were detected. Use PascalCase for classes if introduced.
- React components: use PascalCase, such as `DownloadVideo`, `Installer`, and `Updater`.
- Types: use PascalCase for TypeScript type aliases, such as `Video`, `Format`, `DownloadOptions`, and `Input`.

## Module Structure

- `src/index.tsx` is the primary Termcast command UI entry point.
- `src/tools/` contains AI tool handlers. Keep these handlers thin and focused on input mapping, command execution, and returned tool data.
- `src/views/` contains reusable Termcast UI views for installer and updater flows.
- `src/utils.ts` contains shared executable detection, URL and time validation, format selection, and file-name sanitization helpers.
- `src/transcript.ts` contains transcript-specific `yt-dlp` and SRT parsing behavior.
- `src/types.ts` contains shared TypeScript data shapes for `yt-dlp` metadata.

## Error Handling

- User-facing UI errors should use Termcast toasts, HUD messages, or visible detail views.
- Tool handlers should throw `Error` instances with actionable messages when required executables or video data are unavailable.
- External process calls use `execa`; inspect known errors where the UI can offer recovery actions.
- Cleanup code should run on both success and failure when temporary files or directories are created.

## Logging

- Avoid routine `console.log` output in command flows.
- `console.error` is currently used only in installer failure paths before showing a user-facing toast.
- Prefer Termcast UI feedback over raw terminal logs for expected user-visible failures.

## Testing

- No dedicated test runner or test files were detected.
- Existing quality gates are TypeScript strict mode and ESLint.
- When adding tests later, prefer focused coverage for URL validation, title sanitization, format selection, transcript cleanup, and platform path detection.
