import { getPreferenceValues } from "termcast";
import { formatDuration, intervalToDuration } from "date-fns";
import { existsSync } from "fs";
import { execSync } from "child_process";
import {
  isValidHHMM as isValidHHMMCore,
  isValidUrl as isValidUrlCore,
  parseHHMM as parseHHMMCore,
} from "./core/validation.js";
import { sanitizeVideoTitle as sanitizeVideoTitleCore } from "./core/sanitize.js";
import type { DownloadOptions as CoreDownloadOptions } from "./core/types.js";
import {
  buildDownloadPlans,
  buildMp4Plans,
  formatFilesize,
  formatTbr,
  getFormatContainers,
  getFormatOptionsForContainer,
  getFormats,
  getFormatTitle,
  getFormatValue,
  MP3_FORMAT_ID,
} from "./core/format-selection.js";

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";

export function getExtendedPath() {
  const basePath = process.env.PATH || "";
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...extraPaths, basePath].join(":");
}

function sanitizeWindowsPath(path: string): string {
  return path.replace(/\r/g, "").replace(/\n/g, "").trim();
}

export const {
  downloadPath,
  homebrewPath,
  autoLoadUrlFromClipboard,
  autoLoadUrlFromSelectedText,
  enableBrowserExtensionSupport,
  forceIpv4,
  ytdlPath: ytdlPathPreference,
  ffmpegPath: ffmpegPathPreference,
  ffprobePath: ffprobePathPreference,
} = getPreferenceValues<ExtensionPreferences>();

export async function getWingetPath() {
  try {
    const wingetPath = sanitizeWindowsPath(execSync("where winget").toString().trim());
    return wingetPath.split("\n")[0];
  } catch {
    throw new Error("Winget not found. Please ensure winget is installed and available in your PATH.");
  }
}

export const getytdlPath = () => {
  const cleanedYtdlPath = isWindows ? sanitizeWindowsPath(ytdlPathPreference || "") : ytdlPathPreference;
  if (cleanedYtdlPath && existsSync(cleanedYtdlPath)) return cleanedYtdlPath;

  try {
    const cmd = isWindows ? "where yt-dlp" : "which yt-dlp";
    return sanitizeWindowsPath(
      execSync(cmd, { env: { ...process.env, PATH: getExtendedPath() } })
        .toString()
        .trim()
        .split("\n")[0],
    );
  } catch {
    // Check common paths on macOS
    const commonPaths = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", `${homebrewPath}/bin/yt-dlp`];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return "";
  }
};

export const getffmpegPath = () => {
  const cleanedFfmpegPath = isWindows ? sanitizeWindowsPath(ffmpegPathPreference || "") : ffmpegPathPreference;
  if (cleanedFfmpegPath && existsSync(cleanedFfmpegPath)) return cleanedFfmpegPath;

  try {
    const cmd = isWindows ? "where ffmpeg" : "which ffmpeg";
    return sanitizeWindowsPath(
      execSync(cmd, { env: { ...process.env, PATH: getExtendedPath() } })
        .toString()
        .trim()
        .split("\n")[0],
    );
  } catch {
    const commonPaths = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", `${homebrewPath}/bin/ffmpeg`];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return "";
  }
};

export const getffprobePath = () => {
  const cleanedFfprobePath = isWindows ? sanitizeWindowsPath(ffprobePathPreference || "") : ffprobePathPreference;
  if (cleanedFfprobePath && existsSync(cleanedFfprobePath)) return cleanedFfprobePath;

  try {
    const cmd = isWindows ? "where ffprobe" : "which ffprobe";
    return sanitizeWindowsPath(
      execSync(cmd, { env: { ...process.env, PATH: getExtendedPath() } })
        .toString()
        .trim()
        .split("\n")[0],
    );
  } catch {
    const commonPaths = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", `${homebrewPath}/bin/ffprobe`];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return "";
  }
};

export type DownloadOptions = CoreDownloadOptions;

export function formatHHMM(seconds: number) {
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });

  return formatDuration(duration, {
    format: duration.hours && duration.hours > 0 ? ["hours", "minutes", "seconds"] : ["minutes", "seconds"],
    zero: true,
    delimiter: ":",
    locale: {
      formatDistance: (_token, count) => String(count).padStart(2, "0"),
    },
  });
}

export function parseHHMM(input: string) {
  return parseHHMMCore(input);
}

export function isValidHHMM(input: string) {
  return isValidHHMMCore(input);
}

export function isValidUrl(url: string) {
  return isValidUrlCore(url);
}

export function sanitizeVideoTitle(name: string): string {
  return sanitizeVideoTitleCore(name, isWindows ? "win32" : process.platform);
}

export {
  buildDownloadPlans,
  buildMp4Plans,
  formatFilesize,
  formatTbr,
  getFormatContainers,
  getFormatOptionsForContainer,
  getFormats,
  getFormatTitle,
  getFormatValue,
  MP3_FORMAT_ID,
};
