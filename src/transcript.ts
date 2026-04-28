import fs from "node:fs";
import { downloadPath, forceIpv4, getExtendedPath, getffmpegPath, getytdlPath } from "./utils.js";
import { TranscriptService } from "./core/services/transcript-service.js";
import { cleanUpSrt } from "./core/transcript/clean-srt.js";

export default async function extractTranscript(url: string, language: string = "en") {
  const ytdlPath = getytdlPath();
  const ffmpegPath = getffmpegPath();

  if (!fs.existsSync(ytdlPath)) {
    throw new Error("yt-dlp is not installed");
  }
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error("ffmpeg is not installed");
  }

  const service = new TranscriptService({
    ytdlpPath: ytdlPath,
    ffmpegPath,
    downloadDirectory: downloadPath,
    forceIpv4: Boolean(forceIpv4),
    timeoutMs: 10 * 60 * 1000,
    maxBufferBytes: 20 * 1024 * 1024,
    env: { PATH: getExtendedPath(), PYTHONUNBUFFERED: "1" },
  });

  return service.extract({ url, language });
}

export { cleanUpSrt };
