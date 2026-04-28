import { readdir } from "node:fs/promises";
import path from "node:path";
import { downloadFailedError, TuitubeError } from "../core/errors.js";
import { MP3_FORMAT_ID } from "../core/format-selection.js";
import { noopLogger, type Logger } from "../core/logger.js";
import type { CommandRuntimeOptions, Video } from "../core/types.js";
import { assertValidUrl } from "../core/validation.js";
import { withPrivateNetworkDeniedProxy } from "./egress-proxy.js";
import { runBufferedCommand, runStreamingCommand } from "./process.js";

export type YtDlpRuntimeOptions = CommandRuntimeOptions & {
  ytdlpPath: string;
  ffmpegPath?: string;
  logger?: Logger;
  cancelSignal?: AbortSignal;
  env?: Record<string, string | undefined>;
};

export type DownloadVideoCommand = YtDlpRuntimeOptions & {
  url: string;
  outputDirectory: string;
  formatValue: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

export type DownloadSubtitleCommand = YtDlpRuntimeOptions & {
  url: string;
  outputDirectory: string;
  language: string;
};

function commonArgs(forceIpv4: boolean, proxyUrl: string): string[] {
  return ["--ignore-config", "--no-playlist", "--proxy", proxyUrl, ...(forceIpv4 ? ["--force-ipv4"] : [])];
}

function withProxyEnv(
  env: Record<string, string | undefined> | undefined,
  proxyUrl: string,
): Record<string, string | undefined> {
  return {
    ...env,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: "",
    no_proxy: "",
  };
}

export function parsePrintedFilePath(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith("/") || /^[a-zA-Z]:\\/.test(line) || line.startsWith("\\\\"));
}

export async function fetchVideoMetadata({
  url,
  ytdlpPath,
  forceIpv4,
  timeoutMs,
  maxBufferBytes,
  cancelSignal,
  env,
  logger = noopLogger,
}: YtDlpRuntimeOptions & { url: string }): Promise<Video> {
  logger.debug("ytdlp.metadata.start");
  assertValidUrl(url);
  const result = await withPrivateNetworkDeniedProxy({ forceIpv4, logger }, async (proxyUrl) => {
    const args = [...commonArgs(forceIpv4, proxyUrl), "--dump-json", "--format-sort=resolution,ext,tbr", "--", url];

    return runBufferedCommand({
      executablePath: ytdlpPath,
      args,
      timeoutMs,
      maxBufferBytes,
      cancelSignal,
      env: withProxyEnv(env, proxyUrl),
      logger,
      phase: "yt-dlp.metadata",
    });
  });

  try {
    const video = JSON.parse(result.stdout) as Video;
    logger.debug("ytdlp.metadata.finish", { formatCount: video.formats?.length ?? 0, liveStatus: video.live_status });
    return video;
  } catch (error) {
    logger.error("ytdlp.metadata.parse_failed", { error: error instanceof Error ? error.message : String(error) });
    throw downloadFailedError("Failed to parse yt-dlp metadata", {}, error);
  }
}

function downloadFormatArgs(formatValue: string): string[] {
  if (formatValue === MP3_FORMAT_ID) {
    return ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"];
  }

  const [downloadFormat, recodeFormat] = formatValue.split("#");
  return ["--format", downloadFormat, ...(recodeFormat ? ["--recode-video", recodeFormat] : [])];
}

export async function downloadVideo({
  url,
  outputDirectory,
  formatValue,
  ytdlpPath,
  ffmpegPath,
  forceIpv4,
  timeoutMs,
  maxBufferBytes,
  cancelSignal,
  env,
  logger = noopLogger,
  onStdoutLine,
  onStderrLine,
}: DownloadVideoCommand): Promise<string> {
  logger.debug("ytdlp.download.start", { outputDirectory, formatValue });
  assertValidUrl(url);
  const result = await withPrivateNetworkDeniedProxy({ forceIpv4, logger }, async (proxyUrl) => {
    const args = [
      ...commonArgs(forceIpv4, proxyUrl),
      ...(ffmpegPath ? ["--ffmpeg-location", ffmpegPath] : []),
      ...downloadFormatArgs(formatValue),
      "--print",
      "after_move:filepath",
      "--newline",
      "--progress",
      "-o",
      path.join(outputDirectory, "%(title).200B (%(id)s).%(ext)s"),
      "--",
      url,
    ];

    return runStreamingCommand({
      executablePath: ytdlpPath,
      args,
      timeoutMs,
      maxBufferBytes,
      cancelSignal,
      env: withProxyEnv(env, proxyUrl),
      logger,
      phase: "yt-dlp.download",
      onStdoutLine,
      onStderrLine,
    });
  });

  const filePath = parsePrintedFilePath(result.stdout);
  if (!filePath) {
    logger.error("ytdlp.download.path_missing");
    throw new TuitubeError({
      code: "DOWNLOAD_FAILED",
      message: "yt-dlp did not print the downloaded file path",
    });
  }

  logger.debug("ytdlp.download.finish", { filePath });
  return filePath;
}

export async function downloadAndConvertSubtitles({
  url,
  outputDirectory,
  language,
  ytdlpPath,
  ffmpegPath,
  forceIpv4,
  timeoutMs,
  maxBufferBytes,
  cancelSignal,
  env,
  logger = noopLogger,
}: DownloadSubtitleCommand): Promise<string> {
  logger.debug("ytdlp.subtitles.start", { language, outputDirectory });
  assertValidUrl(url);
  await withPrivateNetworkDeniedProxy({ forceIpv4, logger }, async (proxyUrl) => {
    const args = [
      ...commonArgs(forceIpv4, proxyUrl),
      "--write-subs",
      "--write-auto-subs",
      "--skip-download",
      "--sub-langs",
      language,
      "--sub-format",
      "vtt/srt/best",
      "--convert-subs",
      "srt",
      ...(ffmpegPath ? ["--ffmpeg-location", ffmpegPath] : []),
      "-o",
      path.join(outputDirectory, "%(id)s.%(ext)s"),
      "--",
      url,
    ];

    await runBufferedCommand({
      executablePath: ytdlpPath,
      args,
      timeoutMs,
      maxBufferBytes,
      cancelSignal,
      env: withProxyEnv(env, proxyUrl),
      logger,
      phase: "yt-dlp.subtitles",
    });
  });

  const files = await readdir(outputDirectory);
  const subtitleFile = files.find((fileName) => fileName.endsWith(".srt"));
  if (!subtitleFile) {
    logger.warn("ytdlp.subtitles.not_found", { language });
    throw new TuitubeError({
      code: "SUBTITLE_NOT_FOUND",
      message: `No ${language} subtitles found for this video`,
      severity: "warn",
      details: { language },
    });
  }

  const subtitlePath = path.join(outputDirectory, subtitleFile);
  logger.debug("ytdlp.subtitles.finish", { language, subtitlePath });
  return subtitlePath;
}
