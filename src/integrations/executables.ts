import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { missingExecutableError } from "../core/errors.js";
import { noopLogger, type Logger } from "../core/logger.js";
import type { ExecutableName } from "../core/types.js";

export type ResolveExecutableOptions = {
  name: ExecutableName;
  explicitPath?: string;
  pathEnv?: string;
  commonPaths?: string[];
  logger?: Logger;
};

export type ResolvedExecutable = {
  name: ExecutableName;
  path: string;
  source: "explicit" | "path" | "common";
};

const defaultCommonPaths: Record<ExecutableName, string[]> = {
  "yt-dlp": ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"],
  ffmpeg: ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
  ffprobe: ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"],
};

async function canExecute(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(name: ExecutableName, pathEnv: string | undefined): string[] {
  const separator = process.platform === "win32" ? ";" : ":";
  const executableNames = process.platform === "win32" && !name.endsWith(".exe") ? [name, `${name}.exe`] : [name];

  return (pathEnv ?? "")
    .split(separator)
    .filter(Boolean)
    .flatMap((directory) => executableNames.map((executableName) => path.join(directory, executableName)));
}

export async function resolveExecutable({
  name,
  explicitPath,
  pathEnv,
  commonPaths = defaultCommonPaths[name],
  logger = noopLogger,
}: ResolveExecutableOptions): Promise<ResolvedExecutable> {
  logger.debug("executable.resolve.start", { name, hasExplicitPath: Boolean(explicitPath) });

  if (explicitPath && (await canExecute(explicitPath))) {
    logger.debug("executable.resolve.finish", { name, source: "explicit" });
    return { name, path: explicitPath, source: "explicit" };
  }

  for (const candidatePath of pathCandidates(name, pathEnv)) {
    if (await canExecute(candidatePath)) {
      logger.debug("executable.resolve.finish", { name, source: "path" });
      return { name, path: candidatePath, source: "path" };
    }
  }

  for (const candidatePath of commonPaths) {
    if (await canExecute(candidatePath)) {
      logger.debug("executable.resolve.finish", { name, source: "common" });
      return { name, path: candidatePath, source: "common" };
    }
  }

  logger.error("executable.resolve.missing", { name });
  throw missingExecutableError(name);
}

export async function resolveExecutables(
  options: Omit<ResolveExecutableOptions, "name" | "explicitPath"> & {
    ytdlpPath?: string;
    ffmpegPath?: string;
    ffprobePath?: string;
  },
): Promise<Record<ExecutableName, ResolvedExecutable>> {
  const [ytdlp, ffmpeg, ffprobe] = await Promise.all([
    resolveExecutable({ ...options, name: "yt-dlp", explicitPath: options.ytdlpPath }),
    resolveExecutable({ ...options, name: "ffmpeg", explicitPath: options.ffmpegPath }),
    resolveExecutable({ ...options, name: "ffprobe", explicitPath: options.ffprobePath }),
  ]);

  return {
    "yt-dlp": ytdlp,
    ffmpeg,
    ffprobe,
  };
}
