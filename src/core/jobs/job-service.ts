import { randomUUID } from "node:crypto";
import { normalizeError } from "../errors.js";
import { noopLogger, type Logger } from "../logger.js";
import type { JobQueue, DownloadJob, JobStatus } from "./queue.js";

export type CreateDownloadJobInput = {
  url: string;
  formatValue?: string;
  chatId?: string;
};

export class JobService {
  private readonly jobs = new Map<string, DownloadJob>();
  private accepting = true;

  constructor(
    private readonly queue: JobQueue<DownloadJob>,
    private readonly logger: Logger = noopLogger,
  ) {}

  async createDownloadJob(input: CreateDownloadJobInput): Promise<DownloadJob> {
    this.logger.info("job_service.create.start", { hasChatId: Boolean(input.chatId) });
    if (!this.accepting) {
      throw normalizeError(new Error("Job service is shutting down"), "Job service is shutting down");
    }

    const now = new Date();
    const job: DownloadJob = {
      id: randomUUID(),
      url: input.url,
      formatValue: input.formatValue,
      chatId: input.chatId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };

    await this.queue.enqueue(job);
    this.jobs.set(job.id, job);
    this.logger.info("job_service.create.finish", { jobId: job.id, status: job.status });
    return job;
  }

  getJob(jobId: string): DownloadJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): DownloadJob[] {
    return [...this.jobs.values()];
  }

  updateJob(jobId: string, status: JobStatus, patch: Partial<DownloadJob> = {}): DownloadJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    const updated = {
      ...job,
      ...patch,
      status,
      updatedAt: new Date(),
    };
    this.jobs.set(jobId, updated);
    this.logger.debug("job_service.update", { jobId, status });
    return updated;
  }

  failJob(jobId: string, error: unknown): DownloadJob | undefined {
    const normalized = normalizeError(error);
    return this.updateJob(jobId, "failed", {
      completedAt: new Date(),
      errorCode: normalized.code,
      errorMessage: normalized.message,
    });
  }

  cancelJob(jobId: string): DownloadJob | undefined {
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
