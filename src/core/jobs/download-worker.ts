import { noopLogger, type Logger } from "../logger.js";
import { MP3_FORMAT_ID } from "../format-selection.js";
import type { DownloadProgress, DownloadProgressSource } from "../download-progress.js";
import { parseYtDlpDownloadProgress } from "../download-progress.js";
import type { VideoDownloadService } from "../services/video-download-service.js";
import type { TranscriptResult, TranscriptService } from "../services/transcript-service.js";
import type { DownloadResult, VideoSelectionSnapshot } from "../types.js";
import type { MediaJob, JobQueue } from "./queue.js";
import { JobService, type CancelJobResult } from "./job-service.js";

export type DownloadWorkerOptions = {
  queue: JobQueue<MediaJob>;
  jobService: JobService;
  downloadService: VideoDownloadService;
  transcriptService?: TranscriptService;
  maxConcurrency?: number;
  logger?: Logger;
  onMetadataPrepared?: (job: MediaJob, snapshot: VideoSelectionSnapshot) => Promise<void>;
  onJobProgress?: (job: MediaJob, progress: DownloadProgress) => Promise<void> | void;
  onJobSending?: (job: MediaJob) => Promise<void> | void;
  onJobCompleted?: (job: MediaJob, result: DownloadResult) => Promise<void>;
  onTranscriptCompleted?: (job: MediaJob, result: TranscriptResult) => Promise<void>;
  onJobFailed?: (job: MediaJob, error: unknown) => Promise<void>;
};

export type StopWorkerOptions = {
  timeoutMs: number;
  cancelRunning?: boolean;
};

export class DownloadWorker {
  private readonly queue: JobQueue<MediaJob>;
  private readonly jobService: JobService;
  private readonly downloadService: VideoDownloadService;
  private readonly transcriptService?: TranscriptService;
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  private readonly onMetadataPrepared?: (job: MediaJob, snapshot: VideoSelectionSnapshot) => Promise<void>;
  private readonly onJobProgress?: (job: MediaJob, progress: DownloadProgress) => Promise<void> | void;
  private readonly onJobSending?: (job: MediaJob) => Promise<void> | void;
  private readonly onJobCompleted?: (job: MediaJob, result: DownloadResult) => Promise<void>;
  private readonly onTranscriptCompleted?: (job: MediaJob, result: TranscriptResult) => Promise<void>;
  private readonly onJobFailed?: (job: MediaJob, error: unknown) => Promise<void>;
  private readonly loopControllers = new Set<AbortController>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly loops: Promise<void>[] = [];
  private started = false;

  constructor(options: DownloadWorkerOptions) {
    this.queue = options.queue;
    this.jobService = options.jobService;
    this.downloadService = options.downloadService;
    this.transcriptService = options.transcriptService;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.logger = options.logger ?? noopLogger;
    this.onMetadataPrepared = options.onMetadataPrepared;
    this.onJobProgress = options.onJobProgress;
    this.onJobSending = options.onJobSending;
    this.onJobCompleted = options.onJobCompleted;
    this.onTranscriptCompleted = options.onTranscriptCompleted;
    this.onJobFailed = options.onJobFailed;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.logger.info("download_worker.start", { maxConcurrency: this.maxConcurrency });
    for (let index = 0; index < this.maxConcurrency; index += 1) {
      const controller = new AbortController();
      this.loopControllers.add(controller);
      this.loops.push(this.runLoop(controller));
    }
  }

  private async runLoop(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      const job = await this.queue.next(controller.signal);
      if (!job) break;
      await this.runJob(job);
    }
    this.loopControllers.delete(controller);
    this.logger.debug("download_worker.loop.finish");
  }

  private async runJob(job: MediaJob): Promise<void> {
    if (this.jobService.getJob(job.id)?.status === "cancelled") {
      this.logger.debug("download_worker.job.skip_cancelled", { jobId: job.id, action: job.action });
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);
    this.jobService.updateJob(job.id, "running", { startedAt: new Date() });
    this.logger.info("download_worker.job.start", {
      jobId: job.id,
      action: job.action,
      hasChatId: Boolean(job.chatId),
    });

    let result: DownloadResult | undefined;
    try {
      switch (job.action) {
        case "prepare_metadata": {
          this.logger.info("download_worker.dispatch", { jobId: job.id, action: job.action });
          const snapshot = await this.downloadService.getSelectionSnapshot(job.payload.url, controller.signal);
          await this.onMetadataPrepared?.(job, snapshot);
          this.jobService.updateJob(job.id, "completed", {
            completedAt: new Date(),
            result: { type: "metadata", snapshot },
          });
          break;
        }
        case "download_best":
        case "download_format":
        case "extract_mp3": {
          if (job.action === "extract_mp3") {
            this.logger.warn("download_worker.compatibility_action", { jobId: job.id, action: job.action });
          }
          this.logger.info("download_worker.dispatch", { jobId: job.id, action: job.action });
          const onStdoutLine = this.createProgressLineObserver(job, "stdout");
          const onStderrLine = this.createProgressLineObserver(job, "stderr");
          result = await this.downloadService.download({
            url: job.payload.url,
            formatValue: job.action === "extract_mp3" ? MP3_FORMAT_ID : job.payload.formatValue,
            cancelSignal: controller.signal,
            onStdoutLine,
            onStderrLine,
          });

          const currentBeforeSending = this.jobService.getJob(job.id);
          if (!currentBeforeSending || currentBeforeSending.status === "cancelled") {
            this.logger.warn("download_worker.job.skip_sending_cancelled", {
              jobId: job.id,
              action: job.action,
              status: currentBeforeSending?.status,
            });
            break;
          }

          const sendingJob = this.jobService.updateJob(job.id, "sending");
          if (!sendingJob || sendingJob.status !== "sending") {
            this.logger.warn("download_worker.job.skip_sending_status", {
              jobId: job.id,
              action: job.action,
              status: sendingJob?.status,
            });
            break;
          }

          await this.notifyJobSending(sendingJob);
          if (this.jobService.getJob(job.id)?.status !== "sending") {
            this.logger.warn("download_worker.job.skip_completed_callback_status", {
              jobId: job.id,
              action: job.action,
              status: this.jobService.getJob(job.id)?.status,
            });
            break;
          }

          await this.onJobCompleted?.(sendingJob, result);
          if (this.jobService.getJob(job.id)?.status !== "sending") {
            this.logger.warn("download_worker.job.skip_completed_update_status", {
              jobId: job.id,
              action: job.action,
              status: this.jobService.getJob(job.id)?.status,
            });
            break;
          }

          this.jobService.updateJob(job.id, "completed", {
            completedAt: new Date(),
            result: {
              type: "download",
              download: {
                filePath: result.filePath,
                fileName: result.fileName,
                title: result.title,
                duration: result.duration,
              },
            },
          });
          break;
        }
        case "extract_transcript": {
          this.logger.warn("download_worker.compatibility_action", { jobId: job.id, action: job.action });
          this.logger.info("download_worker.dispatch", { jobId: job.id, action: job.action });
          if (!this.transcriptService) {
            throw new Error("Transcript service is not configured");
          }
          const transcript = await this.transcriptService.extract({
            url: job.payload.url,
            language: job.payload.language,
            cancelSignal: controller.signal,
          });
          await this.onTranscriptCompleted?.(job, transcript);
          this.jobService.updateJob(job.id, "completed", {
            completedAt: new Date(),
            result: { type: "transcript", transcript },
          });
          break;
        }
      }
      this.logger.info("download_worker.job.finish", { jobId: job.id, action: job.action });
    } catch (error) {
      if (controller.signal.aborted) {
        this.jobService.cancelJob(job.id);
        this.logger.warn("download_worker.job.cancelled", { jobId: job.id, action: job.action });
      } else {
        const failedJob = this.jobService.failJob(job.id, error);
        this.logger.error("download_worker.job.failed", {
          jobId: job.id,
          action: job.action,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.notifyJobFailed(failedJob, error);
      }
    } finally {
      this.activeControllers.delete(job.id);
      await result?.cleanup();
    }
  }

  private async notifyJobFailed(job: MediaJob | undefined, error: unknown): Promise<void> {
    if (!job || job.status !== "failed") return;

    try {
      await this.onJobFailed?.(job, error);
    } catch (notifyError) {
      this.logger.error("download_worker.job.failure_callback_failed", {
        jobId: job.id,
        action: job.action,
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }

  private async notifyJobSending(job: MediaJob): Promise<void> {
    try {
      await this.onJobSending?.(job);
    } catch (error) {
      this.logger.warn("download_worker.job.sending_callback_failed", {
        jobId: job.id,
        action: job.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private createProgressLineObserver(job: MediaJob, source: DownloadProgressSource): (line: string) => void {
    return (line) => {
      const parsed = parseYtDlpDownloadProgress(line);
      if (!parsed) return;
      const progress: DownloadProgress = { ...parsed, source };
      this.logger.debug("download_worker.progress.emit", {
        jobId: job.id,
        action: job.action,
        percent: progress.percent,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        totalBytesEstimate: progress.totalBytesEstimate,
        source,
      });
      void Promise.resolve(this.onJobProgress?.(job, progress)).catch((error: unknown) => {
        this.logger.warn("download_worker.progress.callback_failed", {
          jobId: job.id,
          action: job.action,
          percent: progress.percent,
          downloadedBytes: progress.downloadedBytes,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
  }

  cancel(jobId: string): CancelJobResult & { abortedActive: boolean } {
    const currentStatus = this.jobService.getJob(jobId)?.status;
    const controller = currentStatus === "running" ? this.activeControllers.get(jobId) : undefined;
    const abortedActive = Boolean(controller);
    this.logger.info("download_worker.cancel", { jobId, currentStatus, abortedActive });
    controller?.abort();
    const result = this.jobService.cancelJob(jobId);
    this.logger.debug("download_worker.cancel.result", {
      jobId,
      abortedActive,
      removedFromQueue: result.removedFromQueue,
      previousStatus: result.previousStatus,
      cancelled: result.cancelled,
    });
    return { ...result, abortedActive };
  }

  async stop({ timeoutMs, cancelRunning = true }: StopWorkerOptions): Promise<void> {
    this.logger.info("download_worker.stop.start", { timeoutMs, cancelRunning });
    this.jobService.stopAccepting();
    this.queue.close();

    for (const controller of this.loopControllers) controller.abort();
    if (cancelRunning) {
      for (const controller of this.activeControllers.values()) controller.abort();
    }

    const waitForLoops = Promise.allSettled(this.loops).then(() => undefined);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
      timeoutId.unref?.();
    });
    await Promise.race([waitForLoops, timeout]);
    if (timeoutId) clearTimeout(timeoutId);
    this.logger.info("download_worker.stop.finish", { activeJobs: this.activeControllers.size });
  }
}
