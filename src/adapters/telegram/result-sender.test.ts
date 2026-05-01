import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { Logger } from "../../core/logger.js";
import type { DownloadResult } from "../../core/types.js";
import { TelegramResultAlreadyNotifiedError, isTelegramResultAlreadyNotifiedError } from "./result-errors.js";
import { TelegramResultSender } from "./result-sender.js";
import { createTelegramUploadPolicy, TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES } from "./upload-limits.js";

const job: MediaJob = {
  id: "job-1",
  action: "download_best",
  payload: { url: "https://example.com/video" },
  chatId: "123",
  status: "running",
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function withDownloadFile<T>(
  fileName: string,
  sizeBytes: number,
  run: (download: DownloadResult) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp-result-sender-"));
  const filePath = path.join(directory, fileName);
  try {
    await writeFile(filePath, "");
    await truncate(filePath, sizeBytes);
    return await run({
      filePath,
      fileName,
      title: "Title",
      duration: 30,
      jobId: "temp-job",
      cleanup: vi.fn(async () => undefined),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createApi(
  overrides: Partial<{
    sendDocument: ReturnType<typeof vi.fn>;
    sendVideo: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    sendDocument: vi.fn(async () => undefined),
    sendVideo: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    ...overrides,
  };
}

function testLogger(): Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function loggerText(logger: ReturnType<typeof testLogger>): string {
  return JSON.stringify({
    debug: logger.debug.mock.calls,
    info: logger.info.mock.calls,
    warn: logger.warn.mock.calls,
    error: logger.error.mock.calls,
  });
}

describe("TelegramResultSender", () => {
  it("sends completed MP4 downloads as streaming videos", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({ api });

    await withDownloadFile("video.mp4", 1024, (download) => sender.sendDownload(job, download));

    expect(api.sendVideo).toHaveBeenCalledWith("123", expect.anything(), {
      caption: expect.stringContaining("Готово"),
      supports_streaming: true,
    });
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("sends non-MP4 downloads as documents", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({ api });

    await withDownloadFile("video.webm", 1024, (download) => sender.sendDownload(job, download));

    expect(api.sendDocument).toHaveBeenCalledWith("123", expect.anything(), {
      caption: expect.stringContaining("Готово"),
    });
    expect(api.sendVideo).not.toHaveBeenCalled();
  });

  it("rejects files above cloud upload limits before uploading", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({ api });

    await expect(
      withDownloadFile("video.mp4", TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1, (download) =>
        sender.sendDownload(job, download),
      ),
    ).rejects.toBeInstanceOf(TelegramResultAlreadyNotifiedError);

    expect(api.sendVideo).not.toHaveBeenCalled();
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("50 МБ"));
  });

  it("allows files above cloud limits when Local Bot API mode is configured", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({
      api,
      uploadPolicy: createTelegramUploadPolicy("http://127.0.0.1:18081"),
    });

    await withDownloadFile("video.mp4", TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1, (download) =>
      sender.sendDownload(job, download),
    );

    expect(api.sendVideo).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends short transcripts as messages", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({ api });

    await sender.sendTranscript(
      { ...job, action: "extract_transcript" },
      { title: "Title", language: "ru", transcript: "Короткая расшифровка" },
    );

    expect(api.sendMessage).toHaveBeenCalledWith("123", "Короткая расшифровка");
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("sends long transcripts as temporary documents", async () => {
    const api = createApi();
    const sender = new TelegramResultSender({ api });

    await sender.sendTranscript(
      { ...job, action: "extract_transcript" },
      { title: "Title", language: "ru", transcript: "а".repeat(4_000) },
    );

    expect(api.sendDocument).toHaveBeenCalledWith("123", expect.anything(), {
      caption: expect.stringContaining("Расшифровка"),
    });
  });

  it("maps Telegram too-large upload errors to readable user copy", async () => {
    const api = createApi({
      sendVideo: vi.fn(async () => {
        throw { error_code: 413, description: "Request Entity Too Large: file is too big" };
      }),
    });
    const sender = new TelegramResultSender({ api });

    await expect(
      withDownloadFile("video.mp4", 1024, (download) => sender.sendDownload(job, download)),
    ).rejects.toBeInstanceOf(TelegramResultAlreadyNotifiedError);
    expect(api.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("слишком большой"));
  });

  it("reports send failures to the chat and rethrows an already-notified error", async () => {
    const api = createApi({
      sendVideo: vi.fn(async () => {
        throw new Error("telegram unavailable");
      }),
    });
    const sender = new TelegramResultSender({ api });

    let thrown: unknown;
    try {
      await withDownloadFile("video.mp4", 1024, (download) => sender.sendDownload(job, download));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TelegramResultAlreadyNotifiedError);
    expect(isTelegramResultAlreadyNotifiedError(thrown)).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("отправить"));
  });

  it("redacts local paths from stat failure logs", async () => {
    const api = createApi();
    const logger = testLogger();
    const sender = new TelegramResultSender({ api, logger });
    const filePath = path.join(process.cwd(), ".tmp-result-sender-secret", "Private Video Title.mp4");

    await expect(
      sender.sendDownload(job, {
        filePath,
        fileName: "Private Video Title.mp4",
        title: "Title",
        duration: 30,
        jobId: "temp-job",
        cleanup: vi.fn(async () => undefined),
      }),
    ).rejects.toBeInstanceOf(TelegramResultAlreadyNotifiedError);

    const logs = loggerText(logger);
    expect(logs).toContain("telegram.result_sender.stat.failed");
    expect(logs).toContain("enoent");
    expect(logs).not.toContain(filePath);
    expect(logs).not.toContain("Private Video Title");
  });

  it("redacts local paths and secret-bearing URLs from upload failure logs", async () => {
    let logs = "";
    await withDownloadFile("secret-upload-title.mp4", 1024, async (download) => {
      const api = createApi({
        sendVideo: vi.fn(async () => {
          throw new Error(
            `ENOENT: upload failed for '${download.filePath}' via https://api.telegram.org/bot123:ABCdef_456/sendVideo`,
          );
        }),
      });
      const logger = testLogger();
      const sender = new TelegramResultSender({ api, logger });

      await expect(sender.sendDownload(job, download)).rejects.toBeInstanceOf(TelegramResultAlreadyNotifiedError);
      logs = loggerText(logger);

      expect(logs).toContain("telegram.result_sender.telegram_upload_failed");
      expect(logs).toContain("enoent");
      expect(logs).not.toContain(download.filePath);
      expect(logs).not.toContain("secret-upload-title");
      expect(logs).not.toContain("ABCdef_456");
      expect(logs).not.toContain("https://api.telegram.org");
    });
  });

  it("throws a safe error when the failure notification cannot be sent", async () => {
    await withDownloadFile("notification-secret-title.mp4", 1024, async (download) => {
      const uploadError = new Error(`upload failed for '${download.filePath}'`);
      const notificationError = new Error(`notification failed for '${download.filePath}'`);
      const api = createApi({
        sendVideo: vi.fn(async () => {
          throw uploadError;
        }),
        sendMessage: vi.fn(async () => {
          throw notificationError;
        }),
      });
      const logger = testLogger();
      const sender = new TelegramResultSender({ api, logger });

      let thrown: unknown;
      try {
        await sender.sendDownload(job, download);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBe(uploadError);
      expect(thrown).not.toBe(notificationError);
      expect(isTelegramResultAlreadyNotifiedError(thrown)).toBe(false);
      expect((thrown as Error).message).toBe("Telegram upload failed; Telegram failure notification failed");
      expect((thrown as Error).message).not.toContain(download.filePath);
      expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();

      const logs = loggerText(logger);
      expect(logs).toContain("telegram.result_sender.notification_failed");
      expect(logs).not.toContain(download.filePath);
      expect(logs).not.toContain("notification-secret-title");
    });
  });

  it("redacts local paths from transcript delivery failure logs", async () => {
    const transcriptTitle = "Private Transcript Title";
    const api = createApi({
      sendDocument: vi.fn(async () => {
        throw new Error(`ENOENT: open '/tmp/tuitube-transcript-test/${transcriptTitle}.txt'`);
      }),
    });
    const logger = testLogger();
    const sender = new TelegramResultSender({ api, logger });

    await expect(
      sender.sendTranscript(
        { ...job, action: "extract_transcript" },
        { title: transcriptTitle, language: "ru", transcript: "а".repeat(4_000) },
      ),
    ).rejects.toBeInstanceOf(TelegramResultAlreadyNotifiedError);

    const logs = loggerText(logger);
    expect(logs).toContain("telegram.result_sender.transcript.failed");
    expect(logs).toContain("enoent");
    expect(logs).not.toContain("/tmp/tuitube-transcript-test");
    expect(logs).not.toContain(transcriptTitle);
  });

  it("throws a safe error when the generic failure notification fails", async () => {
    const api = createApi({
      sendMessage: vi.fn(async () => {
        throw new Error("notification failed for '/tmp/private-video-title.mp4'");
      }),
    });
    const logger = testLogger();
    const sender = new TelegramResultSender({ api, logger });

    await expect(sender.sendFailure({ ...job, status: "failed" })).rejects.toThrow(
      "Telegram failure notification failed",
    );

    const logs = loggerText(logger);
    expect(logs).toContain("telegram.result_sender.failure_notification_failed");
    expect(logs).not.toContain("/tmp/private-video-title.mp4");
    expect(logs).not.toContain("private-video-title");
  });
});
