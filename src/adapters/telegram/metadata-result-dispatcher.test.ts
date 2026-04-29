import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { VideoSelectionSnapshot } from "../../core/types.js";
import { TelegramMenuSessionStore } from "./menu-session-store.js";
import { TelegramMetadataResultDispatcher } from "./metadata-result-dispatcher.js";

const job: MediaJob = {
  id: "job-1",
  action: "prepare_metadata",
  payload: { url: "https://example.com/video" },
  chatId: "123",
  status: "running",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const snapshot: VideoSelectionSnapshot = {
  title: "Title",
  duration: 30,
  formatOptions: [],
};

describe("TelegramMetadataResultDispatcher", () => {
  it("creates a menu session for the actual Telegram message id", async () => {
    const store = new TelegramMenuSessionStore();
    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 77 })),
      editMessageText: vi.fn(async () => undefined),
    };
    const dispatcher = new TelegramMetadataResultDispatcher({
      api,
      store,
      menus: {
        renderRootMenuMarkup: vi.fn(async () => ({ inline_keyboard: [] })),
      },
    });

    await dispatcher.dispatchPrepared(job, snapshot);

    expect(store.get({ chatId: "123", messageId: 77 }).status).toBe("found");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.editMessageText).toHaveBeenCalledWith(
      "123",
      77,
      expect.stringContaining("Видео: Title"),
      { reply_markup: { inline_keyboard: [] } },
    );
  });

  it("reports preparation failures without leaking internal errors", async () => {
    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 77 })),
      editMessageText: vi.fn(async () => undefined),
    };
    const dispatcher = new TelegramMetadataResultDispatcher({
      api,
      store: new TelegramMenuSessionStore(),
      menus: {
        renderRootMenuMarkup: vi.fn(async () => ({ inline_keyboard: [] })),
      },
    });

    await dispatcher.dispatchFailed({ ...job, errorCode: "DOWNLOAD_FAILED" });

    expect(api.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("Не удалось подготовить"));
  });
});

