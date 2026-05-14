import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
import { TelegramDownloadProgressDispatcher } from "./download-progress-dispatcher.js";

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: "job-1",
    action: "download_format",
    payload: {
      url: "https://example.com/video",
      formatValue: "18#mp4",
      menuMessageId: 77,
      expectedSizeBytes: 2 * 1024 ** 2,
    },
    chatId: "123",
    status: "running",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("TelegramDownloadProgressDispatcher", () => {
  it("sends throttled progress edits with expected totals", async () => {
    let now = 1_000;
    const editMessageText = vi.fn(async () => undefined);
    const dispatcher = new TelegramDownloadProgressDispatcher({
      api: { editMessageText },
      now: () => now,
      renderReplyMarkup: async () => ({ inline_keyboard: [[{ text: "Назад", callback_data: "back" }]] }),
    });

    await dispatcher.dispatch(job(), { downloadedBytes: 512 * 1024, percent: 25 });
    now += 500;
    await dispatcher.dispatch(job(), { downloadedBytes: 768 * 1024, percent: 26 });
    now += 600;
    await dispatcher.dispatch(job(), { downloadedBytes: 1024 * 1024, percent: 50 });

    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText.mock.calls[0]?.[2]).toContain("Скачивание запущено: 512.0 КБ / ~2.0 МБ");
    expect(editMessageText.mock.calls[1]?.[2]).toContain("1.0 МБ / ~2.0 МБ");
  });

  it("coalesces concurrent progress bursts inside the serialized edit chain", async () => {
    let now = 1_000;
    const editMessageText = vi.fn(async () => undefined);
    const dispatcher = new TelegramDownloadProgressDispatcher({
      api: { editMessageText },
      now: () => now,
      renderReplyMarkup: async () => ({ inline_keyboard: [] }),
    });

    await Promise.all([
      dispatcher.dispatch(job(), { downloadedBytes: 256 * 1024, percent: 12 }),
      dispatcher.dispatch(job(), { downloadedBytes: 384 * 1024, percent: 18 }),
      dispatcher.dispatch(job(), { downloadedBytes: 512 * 1024, percent: 24 }),
      dispatcher.dispatch(job(), { downloadedBytes: 640 * 1024, percent: 30 }),
    ]);

    expect(editMessageText).toHaveBeenCalledTimes(1);

    now += 1_100;
    await dispatcher.dispatch(job(), { downloadedBytes: 768 * 1024, percent: 36 });

    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText.mock.calls[1]?.[2]).toContain("768.0 КБ / ~2.0 МБ");
  });

  it("accumulates visible bytes across merged-download stage resets", async () => {
    let now = 1_000;
    const editMessageText = vi.fn(async () => undefined);
    const dispatcher = new TelegramDownloadProgressDispatcher({
      api: { editMessageText },
      now: () => now,
      renderReplyMarkup: async () => ({ inline_keyboard: [] }),
    });

    await dispatcher.dispatch(
      job({ payload: { url: "https://example.com/video", menuMessageId: 77, expectedSizeBytes: 1000 * 1024 } }),
      {
        downloadedBytes: 800 * 1024,
        totalBytes: 900 * 1024,
        percent: 88.9,
      },
    );
    now += 1_100;
    await dispatcher.dispatch(
      job({ payload: { url: "https://example.com/video", menuMessageId: 77, expectedSizeBytes: 1000 * 1024 } }),
      {
        downloadedBytes: 50 * 1024,
        totalBytes: 100 * 1024,
        percent: 50,
      },
    );

    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText.mock.calls[0]?.[2]).toContain("800.0 КБ");
    expect(editMessageText.mock.calls[1]?.[2]).toContain("850.0 КБ");
    expect(editMessageText.mock.calls[1]?.[2]).toContain("85%");
  });

  it("suppresses delayed progress after terminal cleanup", async () => {
    const editMessageText = vi.fn(async () => undefined);
    const dispatcher = new TelegramDownloadProgressDispatcher({
      api: { editMessageText },
      renderReplyMarkup: async () => ({ inline_keyboard: [] }),
    });

    await dispatcher.dispatch(job(), { downloadedBytes: 1024, percent: 1 });
    dispatcher.markTerminal("job-1", "completed");
    await dispatcher.dispatch(job(), { downloadedBytes: 2048, percent: 2 }, { force: true });

    expect(editMessageText).toHaveBeenCalledTimes(1);
  });

  it("re-checks terminal suppression after rendering reply markup", async () => {
    const editMessageText = vi.fn(async () => undefined);
    let dispatcher: TelegramDownloadProgressDispatcher;
    dispatcher = new TelegramDownloadProgressDispatcher({
      api: { editMessageText },
      renderReplyMarkup: async () => {
        dispatcher.markTerminal("job-1", "cancelled");
        return { inline_keyboard: [] };
      },
    });

    await dispatcher.dispatch(job(), { downloadedBytes: 1024, percent: 1 }, { force: true });

    expect(editMessageText).not.toHaveBeenCalled();
  });
});
