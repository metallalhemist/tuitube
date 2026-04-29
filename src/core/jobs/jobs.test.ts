import { describe, expect, it, vi } from "vitest";
import { TuitubeError } from "../errors.js";
import type { VideoDownloadService } from "../services/video-download-service.js";
import { InMemoryJobQueue } from "./in-memory-queue.js";
import { JobService } from "./job-service.js";
import { DownloadWorker } from "./download-worker.js";
import type { DownloadJob } from "./queue.js";

function job(id: string): DownloadJob {
  return {
    id,
    action: "download_best",
    payload: { url: "https://example.com/video" },
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("jobs", () => {
  it("rejects enqueues over capacity", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 1 });
    await queue.enqueue(job("1"));
    await expect(queue.enqueue(job("2"))).rejects.toMatchObject({ code: "QUEUE_FULL" } satisfies Partial<TuitubeError>);
  });

  it("cancels an active worker job during shutdown", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video" });

    const download = vi.fn(
      ({ cancelSignal }: { cancelSignal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          cancelSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }) as Promise<never>,
    );

    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
    });

    worker.start();
    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("running"));
    await worker.stop({ timeoutMs: 100, cancelRunning: true });
    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("cancelled"));
  });

  it("records a job before immediate queue delivery can start it", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const waiter = queue.next();

    const created = await jobService.createMediaJob({
      action: "prepare_metadata",
      payload: { url: "https://example.com/video" },
      chatId: "123",
    });
    const delivered = await waiter;

    expect(delivered?.id).toBe(created.id);
    expect(jobService.getJob(created.id)?.status).toBe("queued");
  });

  it("rolls back job records when enqueueing fails", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 0 });
    const jobService = new JobService(queue);

    await expect(
      jobService.createMediaJob({
        action: "prepare_metadata",
        payload: { url: "https://example.com/video" },
      }),
    ).rejects.toMatchObject({ code: "QUEUE_FULL" });
    expect(jobService.listJobs()).toHaveLength(0);
  });

  it("does not overwrite terminal jobs with later worker updates", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video" });

    jobService.cancelJob(created.id);
    jobService.updateJob(created.id, "running", { startedAt: new Date() });

    expect(jobService.getJob(created.id)?.status).toBe("cancelled");
  });

  it("removes queued jobs during cancellation so workers skip them", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video" });

    jobService.cancelJob(created.id);

    expect(queue.size()).toBe(0);
    expect(jobService.getJob(created.id)?.status).toBe("cancelled");
  });

  it("notifies failure callbacks with the failed metadata job", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createMediaJob({
      action: "prepare_metadata",
      payload: { url: "https://example.com/video" },
      chatId: "123",
    });
    const error = new TuitubeError({ code: "DOWNLOAD_FAILED", message: "metadata unavailable" });
    const getSelectionSnapshot = vi.fn(async () => {
      throw error;
    });
    const onJobFailed = vi.fn(async () => undefined);
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { getSelectionSnapshot } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      onJobFailed,
    });

    worker.start();

    await vi.waitFor(() => expect(onJobFailed).toHaveBeenCalledTimes(1));
    expect(jobService.getJob(created.id)).toMatchObject({
      status: "failed",
      errorCode: "DOWNLOAD_FAILED",
    });
    expect(onJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        action: "prepare_metadata",
        status: "failed",
        errorCode: "DOWNLOAD_FAILED",
      }),
      error,
    );
    await worker.stop({ timeoutMs: 100 });
  });

  it("notifies failure callbacks with the failed download job", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video", chatId: "123" });
    const error = new TuitubeError({ code: "POLICY_REJECTED", message: "Download rejected by policy" });
    const download = vi.fn(async () => {
      throw error;
    });
    const onJobFailed = vi.fn(async () => undefined);
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      onJobFailed,
    });

    worker.start();

    await vi.waitFor(() => expect(onJobFailed).toHaveBeenCalledTimes(1));
    expect(jobService.getJob(created.id)).toMatchObject({
      status: "failed",
      errorCode: "POLICY_REJECTED",
    });
    expect(onJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        action: "download_best",
        status: "failed",
        errorCode: "POLICY_REJECTED",
      }),
      error,
    );
    await worker.stop({ timeoutMs: 100 });
  });

  it("clears the shutdown deadline timer after worker loops settle", async () => {
    vi.useFakeTimers();
    try {
      const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
      const jobService = new JobService(queue);
      const worker = new DownloadWorker({
        queue,
        jobService,
        downloadService: { download: vi.fn() } as unknown as VideoDownloadService,
        maxConcurrency: 1,
      });

      worker.start();
      await worker.stop({ timeoutMs: 60_000, cancelRunning: true });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
