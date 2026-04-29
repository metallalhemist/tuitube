import path from "node:path";
import { assertNotLiveStream, assertValidUrl } from "../validation.js";
import { sanitizeVideoTitle } from "../sanitize.js";
import { buildSerializableFormatOptions, chooseDownloadFormat } from "../format-selection.js";
import {
  assertPolicyAllowed,
  defaultDownloadPolicy,
  evaluateDownloadPolicy,
  type DownloadPolicyConfig,
} from "../policy/download-policy.js";
import { createTempJobDirectory } from "../jobs/temp-job.js";
import { TuitubeError } from "../errors.js";
import { noopLogger, type Logger } from "../logger.js";
import type { DownloadResult, SerializableFormatOption, Video, VideoSelectionSnapshot } from "../types.js";
import { getFreeDiskSpaceBytes } from "../../integrations/filesystem.js";
import { downloadVideo, fetchVideoMetadata } from "../../integrations/yt-dlp.js";

export type VideoDownloadServiceOptions = {
  ytdlpPath: string;
  ffmpegPath?: string;
  downloadDirectory: string;
  timeoutMs: number;
  maxBufferBytes: number;
  forceIpv4: boolean;
  policy?: DownloadPolicyConfig;
  logger?: Logger;
  env?: Record<string, string | undefined>;
};

export type DownloadVideoServiceCommand = {
  url: string;
  formatValue?: string;
  cancelSignal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

export class VideoDownloadService {
  private readonly policy: DownloadPolicyConfig;
  private readonly logger: Logger;

  constructor(private readonly options: VideoDownloadServiceOptions) {
    this.policy = options.policy ?? defaultDownloadPolicy;
    this.logger = options.logger ?? noopLogger;
  }

  private async getPolicyFreeDiskBytes(): Promise<number | undefined> {
    if (this.policy.checkFreeDisk === false) {
      this.logger.debug("video_download.policy.free_disk_check_skipped");
      return undefined;
    }

    const { freeBytes } = await getFreeDiskSpaceBytes(this.options.downloadDirectory, this.logger);
    return freeBytes;
  }

  async getMetadata(url: string, cancelSignal?: AbortSignal): Promise<Video> {
    this.logger.debug("video_download.metadata.start");
    assertValidUrl(url);
    const video = await fetchVideoMetadata({
      url,
      ytdlpPath: this.options.ytdlpPath,
      forceIpv4: this.options.forceIpv4,
      timeoutMs: this.options.timeoutMs,
      maxBufferBytes: this.options.maxBufferBytes,
      ffmpegPath: this.options.ffmpegPath,
      cancelSignal,
      env: this.options.env,
      logger: this.logger,
    });
    assertNotLiveStream(video);
    const sanitizedVideo = { ...video, title: sanitizeVideoTitle(video.title) };
    this.logger.debug("video_download.metadata.finish", {
      duration: sanitizedVideo.duration,
      formatCount: sanitizedVideo.formats.length,
    });
    return sanitizedVideo;
  }

  async getFormatOptions(url: string, cancelSignal?: AbortSignal): Promise<SerializableFormatOption[]> {
    this.logger.debug("video_download.format_options.start");
    const video = await this.getMetadata(url, cancelSignal);
    const freeBytes = await this.getPolicyFreeDiskBytes();
    const options = buildSerializableFormatOptions(video, (format) =>
      evaluateDownloadPolicy({ format, video, policy: this.policy, freeDiskBytes: freeBytes }),
    );
    this.logger.debug("video_download.format_options.finish", { count: options.length });
    return options;
  }

  async getSelectionSnapshot(url: string, cancelSignal?: AbortSignal): Promise<VideoSelectionSnapshot> {
    this.logger.debug("video_download.selection_snapshot.start");
    const video = await this.getMetadata(url, cancelSignal);
    const freeBytes = await this.getPolicyFreeDiskBytes();
    const formatOptions = buildSerializableFormatOptions(video, (format) =>
      evaluateDownloadPolicy({ format, video, policy: this.policy, freeDiskBytes: freeBytes }),
    );

    this.logger.debug("video_download.selection_snapshot.finish", {
      duration: video.duration,
      formatCount: formatOptions.length,
    });

    return {
      title: video.title,
      duration: video.duration,
      formatOptions,
    };
  }

  async download({
    url,
    formatValue,
    cancelSignal,
    onStdoutLine,
    onStderrLine,
  }: DownloadVideoServiceCommand): Promise<DownloadResult> {
    this.logger.info("video_download.download.start");
    let tempJob: Awaited<ReturnType<typeof createTempJobDirectory>> | undefined;

    try {
      const video = await this.getMetadata(url, cancelSignal);
      const freeBytes = await this.getPolicyFreeDiskBytes();
      const choice =
        chooseDownloadFormat(video, formatValue, (format) => {
          const state = evaluateDownloadPolicy({
            format,
            video,
            policy: this.policy,
            freeDiskBytes: freeBytes,
          });
          return !state.disabled;
        }) ?? chooseDownloadFormat(video, formatValue);
      if (!choice) {
        throw new TuitubeError({
          code: "DOWNLOAD_FAILED",
          message: "No downloadable format is available",
        });
      }

      this.logger.debug("video_download.format_chosen", {
        formatId: choice.formatId,
        extension: choice.extension,
        reason: choice.reason,
      });

      const policyState = evaluateDownloadPolicy({
        format: choice.format,
        video,
        policy: this.policy,
        freeDiskBytes: freeBytes,
      });
      this.logger.debug("video_download.policy", { disabled: policyState.disabled, reason: policyState.reason });
      assertPolicyAllowed(policyState, { formatId: choice.formatId });

      tempJob = await createTempJobDirectory({
        baseDirectory: this.options.downloadDirectory,
        logger: this.logger,
      });

      const filePath = await downloadVideo({
        url,
        outputDirectory: tempJob.path,
        formatValue: choice.value,
        ytdlpPath: this.options.ytdlpPath,
        ffmpegPath: this.options.ffmpegPath,
        forceIpv4: this.options.forceIpv4,
        timeoutMs: this.options.timeoutMs,
        maxBufferBytes: this.options.maxBufferBytes,
        cancelSignal,
        env: this.options.env,
        logger: this.logger,
        onStdoutLine,
        onStderrLine,
      });

      this.logger.info("video_download.download.finish", { jobId: tempJob.jobId, fileName: path.basename(filePath) });
      return {
        filePath,
        fileName: path.basename(filePath),
        title: video.title,
        duration: video.duration,
        jobId: tempJob.jobId,
        cleanup: tempJob.cleanup,
      };
    } catch (error) {
      this.logger.error("video_download.download.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await tempJob?.cleanup();
      throw error;
    }
  }
}
