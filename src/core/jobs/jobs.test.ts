import { describe, expect, it, vi } from "vitest";
import { TuitubeError } from "../errors.js";
import { YTDLP_PROGRESS_PREFIX } from "../download-progress.js";
import { MP3_FORMAT_ID } from "../format-selection.js";
import type { Logger } from "../logger.js";
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

function testLogger(): Logger & { warn: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

  it("keeps legacy extract_mp3 jobs worker-compatible as MP3 download_format fallback", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createMediaJob({
      action: "extract_mp3",
      payload: { url: "https://example.com/video" },
      chatId: "123",
    });
    const cleanup = vi.fn(async () => undefined);
    const download = vi.fn(async () => ({
      filePath: "/tmp/audio.mp3",
      fileName: "audio.mp3",
      title: "Title",
      duration: 30,
      jobId: "temp-job",
      cleanup,
    }));
    const logger = testLogger();
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      logger,
    });

    worker.start();

    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("completed"));
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ formatValue: MP3_FORMAT_ID }));
    expect(logger.warn).toHaveBeenCalledWith("download_worker.compatibility_action", {
      jobId: created.id,
      action: "extract_mp3",
    });
    await worker.stop({ timeoutMs: 100 });
  });

  it("emits parsed download progress for downloadable jobs", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createMediaJob({
      action: "download_format",
      payload: { url: "https://example.com/video", formatValue: "18#mp4" },
      chatId: "123",
    });
    const onJobProgress = vi.fn();
    const download = vi.fn(async ({ onStdoutLine }: { onStdoutLine?: (line: string) => void }) => {
      onStdoutLine?.(`${YTDLP_PROGRESS_PREFIX}\tdownloading\t50\t100\tNA\t50%`);
      return {
        filePath: "/tmp/video.mp4",
        fileName: "video.mp4",
        title: "Title",
        duration: 30,
        jobId: "temp-job",
        cleanup: vi.fn(async () => undefined),
      };
    });
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      onJobProgress,
    });

    worker.start();

    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("completed"));
    await vi.waitFor(() => expect(onJobProgress).toHaveBeenCalledTimes(1));
    expect(onJobProgress).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      expect.objectContaining({ percent: 50, downloadedBytes: 50, totalBytes: 100, source: "stdout" }),
    );
    await worker.stop({ timeoutMs: 100 });
  });

  it("does not emit download progress for metadata or transcript jobs", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const metadataJob = await jobService.createMediaJob({
      action: "prepare_metadata",
      payload: { url: "https://example.com/video" },
      chatId: "123",
    });
    const transcriptJob = await jobService.createMediaJob({
      action: "extract_transcript",
      payload: { url: "https://example.com/video", language: "ru" },
      chatId: "123",
    });
    const onJobProgress = vi.fn();
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: {
        getSelectionSnapshot: vi.fn(async () => ({ title: "Title", duration: 30, formatOptions: [] })),
      } as unknown as VideoDownloadService,
      transcriptService: {
        extract: vi.fn(async () => ({ title: "Title", language: "ru", transcript: "text" })),
      } as never,
      maxConcurrency: 1,
      onJobProgress,
    });

    worker.start();

    await vi.waitFor(() => expect(jobService.getJob(metadataJob.id)?.status).toBe("completed"));
    await vi.waitFor(() => expect(jobService.getJob(transcriptJob.id)?.status).toBe("completed"));
    expect(onJobProgress).not.toHaveBeenCalled();
    await worker.stop({ timeoutMs: 100 });
  });

  it("returns cancellation details for queued jobs", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video" });

    const result = jobService.cancelJob(created.id);

    expect(result).toMatchObject({
      previousStatus: "queued",
      cancelled: true,
      removedFromQueue: true,
      wasTerminal: false,
    });
    expect(jobService.getJob(created.id)?.status).toBe("cancelled");
  });

  it("refuses cancellation once a job is in the sending phase", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video" });
    await queue.next();
    jobService.updateJob(created.id, "running", { startedAt: new Date() });
    jobService.updateJob(created.id, "sending");

    const result = jobService.cancelJob(created.id);

    expect(result).toMatchObject({
      previousStatus: "sending",
      cancelled: false,
      removedFromQueue: false,
      wasTerminal: false,
    });
    expect(jobService.getJob(created.id)?.status).toBe("sending");
  });

  it("does not send or complete a download job that was cancelled before completion delivery starts", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video", chatId: "123" });
    const onJobCompleted = vi.fn(async () => undefined);
    const download = vi.fn(async () => {
      jobService.cancelJob(created.id);
      return {
        filePath: "/tmp/video.mp4",
        fileName: "video.mp4",
        title: "Title",
        duration: 30,
        jobId: "temp-job",
        cleanup: vi.fn(async () => undefined),
      };
    });
    const worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      onJobCompleted,
    });

    worker.start();

    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("cancelled"));
    expect(onJobCompleted).not.toHaveBeenCalled();
    await worker.stop({ timeoutMs: 100 });
  });

  it("keeps sending jobs non-cancellable while a long completion delivery is in flight", async () => {
    const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: 5 });
    const jobService = new JobService(queue);
    const created = await jobService.createDownloadJob({ url: "https://example.com/video", chatId: "123" });
    let finishSending: (() => void) | undefined;
    let cancelResult: ReturnType<DownloadWorker["cancel"]> | undefined;
    const download = vi.fn(async () => ({
      filePath: "/tmp/video.mp4",
      fileName: "video.mp4",
      title: "Title",
      duration: 30,
      jobId: "temp-job",
      cleanup: vi.fn(async () => undefined),
    }));
    let worker: DownloadWorker;
    const onJobCompleted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSending = resolve;
        }),
    );
    worker = new DownloadWorker({
      queue,
      jobService,
      downloadService: { download } as unknown as VideoDownloadService,
      maxConcurrency: 1,
      onJobSending: (job) => {
        cancelResult = worker.cancel(job.id);
      },
      onJobCompleted,
    });

    worker.start();

    await vi.waitFor(() => expect(onJobCompleted).toHaveBeenCalledTimes(1));
    expect(cancelResult).toMatchObject({ previousStatus: "sending", cancelled: false, abortedActive: false });
    expect(jobService.getJob(created.id)?.status).toBe("sending");

    finishSending?.();
    await vi.waitFor(() => expect(jobService.getJob(created.id)?.status).toBe("completed"));
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
