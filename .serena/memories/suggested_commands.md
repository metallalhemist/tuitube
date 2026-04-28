# Suggested Commands

Development:
- `npm install` or the package manager already used locally to install dependencies.
- `npm run dev` starts Termcast development mode.
- `npm run build` builds the Termcast extension.

Quality checks:
- `npx tsc --noEmit` runs TypeScript checking with the project `tsconfig.json`.
- `npx eslint src --ext .ts,.tsx` runs ESLint against source files if needed.
- `npx prettier --check .` checks formatting if needed.
- There is currently no dedicated test script or test runner configured in `package.json`.

External runtime dependencies:
- macOS: `brew install yt-dlp ffmpeg`.
- Check executable paths with `which yt-dlp`, `which ffmpeg`, and `which ffprobe`.
- Windows: `winget install --id=yt-dlp.yt-dlp -e`; paths can be checked with PowerShell `Get-Command`.

Useful Linux shell commands:
- `pwd` shows the current directory.
- `ls` lists files.
- `find <dir> -maxdepth <n> -type f` lists files by depth.
- `rg <pattern>` searches text quickly.
- `rg --files` lists tracked/unignored files quickly.
- `git status --short` checks working tree state.
- `git diff -- <path>` inspects unstaged changes.