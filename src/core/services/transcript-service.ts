import { readFile } from "node:fs/promises";
import { createTempJobDirectory } from "../jobs/temp-job.js";
import { noopLogger, type Logger } from "../logger.js";
import { sanitizeVideoTitle } from "../sanitize.js";
import { assertNotLiveStream, assertValidUrl } from "../validation.js";
import type { CommandRuntimeOptions } from "../types.js";
import { cleanUpSrt } from "../transcript/clean-srt.js";
import { downloadAndConvertSubtitles, fetchVideoMetadata } from "../../integrations/yt-dlp.js";

export type TranscriptServiceOptions = CommandRuntimeOptions & {
  ytdlpPath: string;
  ffmpegPath: string;
  downloadDirectory: string;
  logger?: Logger;
  env?: Record<string, string | undefined>;
};

export type ExtractTranscriptCommand = {
  url: string;
  language?: string;
  cancelSignal?: AbortSignal;
};

export type TranscriptResult = {
  transcript: string;
  title: string;
  language: string;
};

export class TranscriptService {
  private readonly logger: Logger;

  constructor(private readonly options: TranscriptServiceOptions) {
    this.logger = options.logger ?? noopLogger;
  }

  async extract({ url, language = "en", cancelSignal }: ExtractTranscriptCommand): Promise<TranscriptResult> {
    this.logger.info("transcript.extract.start", { language });
    assertValidUrl(url);

    const tempJob = await createTempJobDirectory({
      baseDirectory: this.options.downloadDirectory,
      logger: this.logger,
    });

    try {
      const video = await fetchVideoMetadata({
        url,
        ytdlpPath: this.options.ytdlpPath,
        ffmpegPath: this.options.ffmpegPath,
        forceIpv4: this.options.forceIpv4,
        timeoutMs: this.options.timeoutMs,
        maxBufferBytes: this.options.maxBufferBytes,
        cancelSignal,
        env: this.options.env,
        logger: this.logger,
      });
      assertNotLiveStream(video);

      const subtitlePath = await downloadAndConvertSubtitles({
        url,
        outputDirectory: tempJob.path,
        language,
        ytdlpPath: this.options.ytdlpPath,
        ffmpegPath: this.options.ffmpegPath,
        forceIpv4: this.options.forceIpv4,
        timeoutMs: this.options.timeoutMs,
        maxBufferBytes: this.options.maxBufferBytes,
        cancelSignal,
        env: this.options.env,
        logger: this.logger,
      });

      const subtitleContent = await readFile(subtitlePath, "utf-8");
      const transcript = cleanUpSrt(subtitleContent);
      this.logger.info("transcript.extract.finish", { language, title: sanitizeVideoTitle(video.title) });

      return {
        transcript,
        title: sanitizeVideoTitle(video.title),
        language,
      };
    } catch (error) {
      this.logger.error("transcript.extract.failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await tempJob.cleanup();
    }
  }
}
