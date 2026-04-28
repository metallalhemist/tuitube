import { TuitubeError } from "../errors.js";
import { noopLogger, type Logger } from "../logger.js";
import type { JobQueue } from "./queue.js";

type Waiter<TJob> = (job: TJob | undefined) => void;

export type InMemoryJobQueueOptions = {
  maxSize?: number;
  logger?: Logger;
};

export class InMemoryJobQueue<TJob extends { id: string }> implements JobQueue<TJob> {
  private readonly jobs: TJob[] = [];
  private readonly waiters: Waiter<TJob>[] = [];
  private readonly maxSize: number;
  private readonly logger: Logger;
  private closed = false;

  constructor({ maxSize = 5, logger = noopLogger }: InMemoryJobQueueOptions = {}) {
    this.maxSize = maxSize;
    this.logger = logger;
  }

  async enqueue(job: TJob): Promise<void> {
    this.logger.debug("queue.enqueue.start", { jobId: job.id, size: this.jobs.length, maxSize: this.maxSize });
    if (this.closed) {
      throw new TuitubeError({
        code: "JOB_CANCELLED",
        message: "Queue is closed",
        severity: "warn",
      });
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(job);
      this.logger.info("queue.enqueue.delivered", { jobId: job.id });
      return;
    }

    if (this.jobs.length >= this.maxSize) {
      this.logger.warn("queue.enqueue.rejected", { reason: "queue_full", maxSize: this.maxSize });
      throw new TuitubeError({
        code: "QUEUE_FULL",
        message: "Job queue is full",
        severity: "warn",
        details: { maxSize: this.maxSize },
      });
    }

    this.jobs.push(job);
    this.logger.info("queue.enqueue.finish", { jobId: job.id, size: this.jobs.length });
  }

  async next(signal?: AbortSignal): Promise<TJob | undefined> {
    const job = this.jobs.shift();
    if (job) {
      this.logger.debug("queue.next.job", { jobId: job.id, size: this.jobs.length });
      return job;
    }

    if (this.closed) return undefined;
    if (signal?.aborted) return undefined;

    this.logger.debug("queue.next.wait");
    return new Promise<TJob | undefined>((resolve) => {
      const waiter: Waiter<TJob> = (nextJob) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(nextJob);
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(undefined);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  size(): number {
    return this.jobs.length;
  }

  close(): void {
    this.closed = true;
    this.logger.info("queue.close", { pending: this.jobs.length, waiters: this.waiters.length });
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(undefined);
    }
  }
}
