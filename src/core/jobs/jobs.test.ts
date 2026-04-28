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
    url: "https://example.com/video",
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
