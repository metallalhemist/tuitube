import fs from "node:fs";
import { termcastCompatibilityDownloadPolicy } from "../core/policy/download-policy.js";
import { VideoDownloadService } from "../core/services/video-download-service.js";
import { downloadPath, forceIpv4, getExtendedPath, getffmpegPath, getffprobePath, getytdlPath } from "../utils.js";

type Input = {
  /**
   * The URL of the video to download.
   */
  url: string;
};

export default async function tool(input: Input) {
  const ytdlPath = getytdlPath();
  const ffmpegPath = getffmpegPath();
  const ffprobePath = getffprobePath();

  if (!fs.existsSync(ytdlPath)) {
    throw new Error("yt-dlp is not installed");
  }
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error("ffmpeg is not installed");
  }
  if (!fs.existsSync(ffprobePath)) {
    throw new Error("ffprobe is not installed");
  }

  const service = new VideoDownloadService({
    ytdlpPath: ytdlPath,
    ffmpegPath,
    downloadDirectory: downloadPath,
    forceIpv4: Boolean(forceIpv4),
    timeoutMs: 30 * 60 * 1000,
    maxBufferBytes: 20 * 1024 * 1024,
    policy: termcastCompatibilityDownloadPolicy,
    env: { PATH: getExtendedPath(), PYTHONUNBUFFERED: "1" },
  });

  const result = await service.download({ url: input.url });

  return {
    downloadedPath: result.filePath,
    fileName: result.fileName,
    title: result.title,
    duration: result.duration,
  };
}
