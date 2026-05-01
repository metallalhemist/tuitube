import { describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { SerializableFormatOption, VideoSelectionSnapshot } from "../../core/types.js";
import { TelegramMenuSessionStore } from "./menu-session-store.js";
import { createDownloadMenus } from "./menus/download-menu.js";
import { TelegramMetadataResultDispatcher } from "./metadata-result-dispatcher.js";
import { createTelegramUploadPolicy, TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES } from "./upload-limits.js";

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

const largeMp4Option: SerializableFormatOption = {
  id: "137+140#mp4",
  value: "137+140#mp4",
  title: "1080p | mp4",
  resolution: "1080p",
  extension: "mp4",
  formatId: "137+140",
  container: "mp4",
  containerLabel: "MP4",
  kind: "merge",
  height: 1080,
  estimatedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1,
  disabled: false,
  policy: { disabled: false, expectedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1 },
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
    expect(api.editMessageText).toHaveBeenCalledWith("123", 77, expect.stringContaining("Видео: Title"), {
      reply_markup: { inline_keyboard: [] },
    });
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

  it("marks over-cloud-limit MP4 options unavailable in rendered menus", async () => {
    const store = new TelegramMenuSessionStore();
    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 77 })),
      editMessageText: vi.fn(async () => undefined),
    };
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-1" })),
      onCancel: vi.fn(async () => undefined),
    });
    const dispatcher = new TelegramMetadataResultDispatcher({
      api,
      store,
      menus,
    });

    await dispatcher.dispatchPrepared(job, {
      ...snapshot,
      formatOptions: [largeMp4Option],
    });

    const messageText = api.sendMessage.mock.calls[0]?.[1];
    const replyMarkup = api.editMessageText.mock.calls[0]?.[3]?.reply_markup;
    expect(messageText).toContain("MP4 для отправки сейчас недоступен");
    expect(
      replyMarkup?.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("лимит Telegram");
  });

  it("allows over-cloud-limit menu options in Local Bot API mode", async () => {
    const uploadPolicy = createTelegramUploadPolicy("http://127.0.0.1:18081");
    const store = new TelegramMenuSessionStore();
    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 77 })),
      editMessageText: vi.fn(async () => undefined),
    };
    const menus = createDownloadMenus({
      store,
      uploadPolicy,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-1" })),
      onCancel: vi.fn(async () => undefined),
    });
    const dispatcher = new TelegramMetadataResultDispatcher({
      api,
      store,
      menus,
      uploadPolicy,
    });

    await dispatcher.dispatchPrepared(job, {
      ...snapshot,
      formatOptions: [largeMp4Option],
    });

    const messageText = api.sendMessage.mock.calls[0]?.[1];
    const replyMarkup = api.editMessageText.mock.calls[0]?.[3]?.reply_markup;
    expect(messageText).not.toContain("MP4 для отправки сейчас недоступен");
    expect(
      replyMarkup?.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).not.toContain("лимит Telegram");
  });
});
