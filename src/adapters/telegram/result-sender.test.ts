import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { DownloadResult } from "../../core/types.js";
import { TelegramResultSender } from "./result-sender.js";

const job: MediaJob = {
  id: "job-1",
  action: "download_best",
  payload: { url: "https://example.com/video" },
  chatId: "123",
  status: "running",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const download: DownloadResult = {
  filePath: "/tmp/video.mp4",
  fileName: "video.mp4",
  title: "Title",
  duration: 30,
  jobId: "temp-job",
  cleanup: vi.fn(async () => undefined),
};

describe("TelegramResultSender", () => {
  it("sends completed downloads as documents", async () => {
    const api = {
      sendDocument: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    };
    const sender = new TelegramResultSender({ api });

    await sender.sendDownload(job, download);

    expect(api.sendDocument).toHaveBeenCalledWith("123", expect.anything(), {
      caption: expect.stringContaining("Готово"),
    });
  });

  it("sends short transcripts as messages", async () => {
    const api = {
      sendDocument: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    };
    const sender = new TelegramResultSender({ api });

    await sender.sendTranscript(
      { ...job, action: "extract_transcript" },
      { title: "Title", language: "ru", transcript: "Короткая расшифровка" },
    );

    expect(api.sendMessage).toHaveBeenCalledWith("123", "Короткая расшифровка");
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("sends long transcripts as temporary documents", async () => {
    const api = {
      sendDocument: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    };
    const sender = new TelegramResultSender({ api });

    await sender.sendTranscript(
      { ...job, action: "extract_transcript" },
      { title: "Title", language: "ru", transcript: "а".repeat(4_000) },
    );

    expect(api.sendDocument).toHaveBeenCalledWith("123", expect.anything(), {
      caption: expect.stringContaining("Расшифровка"),
    });
  });

  it("reports send failures to the chat and rethrows", async () => {
    const api = {
      sendDocument: vi.fn(async () => {
        throw new Error("telegram unavailable");
      }),
      sendMessage: vi.fn(async () => undefined),
    };
    const sender = new TelegramResultSender({ api });

    await expect(sender.sendDownload(job, download)).rejects.toThrow("telegram unavailable");
    expect(api.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("отправить"));
  });
});

