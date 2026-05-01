import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
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
});
