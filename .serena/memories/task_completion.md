# Task Completion Checklist

Before finishing code changes in this project:
- Review `git status --short` and do not revert unrelated user changes.
- Run `npm run build` for a full Termcast build when changes touch source code or package config.
- Run `npx tsc --noEmit` for TypeScript type checking if build is too broad or when validating type-only changes.
- Run ESLint with `npx eslint src --ext .ts,.tsx` when changing TypeScript/React code.
- If formatting-sensitive files were edited, run `npx prettier --check .` or format the touched files with Prettier.
- There is no project test runner configured at the moment; mention that no dedicated tests were run if only build/type/lint checks are available.

For feature work:
- Preserve macOS and Windows executable detection behavior.
- Keep `yt-dlp`, `ffmpeg`, and `ffprobe` command invocations argument-array based.
- Validate URLs and sanitize output filenames.
- Ensure temporary files/directories are cleaned up on success and failure.