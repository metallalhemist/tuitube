import { noopLogger, type Logger } from "../logger.js";
import type { VideoDownloadService } from "../services/video-download-service.js";
import type { DownloadResult } from "../types.js";
import type { DownloadJob, JobQueue } from "./queue.js";
import { JobService } from "./job-service.js";

export type DownloadWorkerOptions = {
  queue: JobQueue<DownloadJob>;
  jobService: JobService;
  downloadService: VideoDownloadService;
  maxConcurrency?: number;
  logger?: Logger;
  onJobCompleted?: (job: DownloadJob, result: DownloadResult) => Promise<void>;
};

export type StopWorkerOptions = {
  timeoutMs: number;
  cancelRunning?: boolean;
};

export class DownloadWorker {
  private readonly queue: JobQueue<DownloadJob>;
  private readonly jobService: JobService;
  private readonly downloadService: VideoDownloadService;
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  private readonly onJobCompleted?: (job: DownloadJob, result: DownloadResult) => Promise<void>;
  private readonly loopControllers = new Set<AbortController>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly loops: Promise<void>[] = [];
  private started = false;

  constructor(options: DownloadWorkerOptions) {
    this.queue = options.queue;
    this.jobService = options.jobService;
    this.downloadService = options.downloadService;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.logger = options.logger ?? noopLogger;
    this.onJobCompleted = options.onJobCompleted;
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

  private async runJob(job: DownloadJob): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);
    this.jobService.updateJob(job.id, "running", { startedAt: new Date() });
    this.logger.info("download_worker.job.start", { jobId: job.id });

    let result: DownloadResult | undefined;
    try {
      result = await this.downloadService.download({
        url: job.url,
        formatValue: job.formatValue,
        cancelSignal: controller.signal,
      });
      await this.onJobCompleted?.(job, result);
      this.jobService.updateJob(job.id, "completed", {
        completedAt: new Date(),
        result: {
          filePath: result.filePath,
          fileName: result.fileName,
          title: result.title,
          duration: result.duration,
        },
      });
      this.logger.info("download_worker.job.finish", { jobId: job.id, fileName: result.fileName });
    } catch (error) {
      if (controller.signal.aborted) {
        this.jobService.cancelJob(job.id);
        this.logger.warn("download_worker.job.cancelled", { jobId: job.id });
      } else {
        this.jobService.failJob(job.id, error);
        this.logger.error("download_worker.job.failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.activeControllers.delete(job.id);
      await result?.cleanup();
    }
  }

  cancel(jobId: string): void {
    this.logger.info("download_worker.cancel", { jobId });
    this.activeControllers.get(jobId)?.abort();
    this.jobService.cancelJob(jobId);
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
