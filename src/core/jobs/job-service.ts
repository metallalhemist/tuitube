import { randomUUID } from "node:crypto";
import { normalizeError } from "../errors.js";
import { noopLogger, type Logger } from "../logger.js";
import type { DownloadJob, JobQueue, JobStatus, MediaJob, MediaJobAction, MediaJobPayload } from "./queue.js";

export type CreateDownloadJobInput = {
  url: string;
  formatValue?: string;
  chatId?: string;
};

export type CreateMediaJobInput = {
  action: MediaJobAction;
  payload: MediaJobPayload;
  chatId?: string;
};

const terminalStatuses = new Set<JobStatus>(["completed", "failed", "cancelled"]);

export class JobService {
  private readonly jobs = new Map<string, MediaJob>();
  private accepting = true;

  constructor(
    private readonly queue: JobQueue<MediaJob>,
    private readonly logger: Logger = noopLogger,
  ) {}

  async createMediaJob(input: CreateMediaJobInput): Promise<MediaJob> {
    this.logger.info("job_service.create.start", { action: input.action, hasChatId: Boolean(input.chatId) });
    if (!this.accepting) {
      throw normalizeError(new Error("Job service is shutting down"), "Job service is shutting down");
    }

    const now = new Date();
    const job: MediaJob = {
      id: randomUUID(),
      action: input.action,
      payload: input.payload,
      chatId: input.chatId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    try {
      await this.queue.enqueue(job);
    } catch (error) {
      this.jobs.delete(job.id);
      const normalized = normalizeError(error);
      this.logger.warn("job_service.create.enqueue_failed", {
        jobId: job.id,
        action: job.action,
        code: normalized.code,
      });
      throw error;
    }

    this.logger.info("job_service.create.finish", { jobId: job.id, action: job.action, status: job.status });
    return job;
  }

  async createDownloadJob(input: CreateDownloadJobInput): Promise<DownloadJob> {
    return this.createMediaJob({
      action: input.formatValue ? "download_format" : "download_best",
      payload: {
        url: input.url,
        formatValue: input.formatValue,
      },
      chatId: input.chatId,
    });
  }

  getJob(jobId: string): MediaJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): MediaJob[] {
    return [...this.jobs.values()];
  }

  updateJob(jobId: string, status: JobStatus, patch: Partial<MediaJob> = {}): MediaJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    if (terminalStatuses.has(job.status)) {
      this.logger.warn("job_service.update.refused_terminal", {
        jobId,
        action: job.action,
        from: job.status,
        to: status,
      });
      return job;
    }

    const updated = {
      ...job,
      ...patch,
      status,
      updatedAt: new Date(),
    };
    this.jobs.set(jobId, updated);
    this.logger.debug("job_service.update", { jobId, action: updated.action, status });
    return updated;
  }

  failJob(jobId: string, error: unknown): MediaJob | undefined {
    const normalized = normalizeError(error);
    this.logger.info("job_service.fail", { jobId, code: normalized.code });
    return this.updateJob(jobId, "failed", {
      completedAt: new Date(),
      errorCode: normalized.code,
      errorMessage: normalized.message,
    });
  }

  cancelJob(jobId: string): MediaJob | undefined {
    const removedFromQueue = this.queue.cancel(jobId);
    this.logger.info("job_service.cancel", { jobId, removedFromQueue });
    return this.updateJob(jobId, "cancelled", {
      completedAt: new Date(),
      errorCode: "JOB_CANCELLED",
      errorMessage: "Job was cancelled",
    });
  }

  stopAccepting(): void {
    this.accepting = false;
    this.logger.info("job_service.stop_accepting");
  }
}
