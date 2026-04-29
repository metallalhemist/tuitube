import { describe, expect, it, vi } from "vitest";
import { TelegramMenuSessionStore, telegramMenuSessionKeyFromMessage } from "./menu-session-store.js";
import type { SerializableFormatOption } from "../../core/types.js";

const option: SerializableFormatOption = {
  id: "18#mp4",
  value: "18#mp4",
  title: "360p | mp4",
  resolution: "360p",
  extension: "mp4",
  formatId: "18",
  estimatedSizeBytes: 100,
  disabled: false,
  policy: { disabled: false, expectedSizeBytes: 100 },
};

describe("TelegramMenuSessionStore", () => {
  it("stores sessions by chat and message id and expires them deterministically", () => {
    let now = 1_000;
    const store = new TelegramMenuSessionStore({ ttlMs: 500, now: () => now });

    const session = store.create({
      chatId: "123",
      messageId: 10,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [option],
    });

    expect(session.expiresAt).toBe(1_500);
    expect(store.get({ chatId: "123", messageId: 10 }).status).toBe("found");

    now = 1_500;
    expect(store.get({ chatId: "123", messageId: 10 }).status).toBe("expired");
    expect(store.size()).toBe(0);
  });

  it("updates and deletes sessions idempotently", () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 10,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [option],
    });

    const updated = store.update({ chatId: "123", messageId: 10 }, { state: "quality", activeJobId: "job-1" });
    expect(updated.status).toBe("found");
    expect(updated.status === "found" ? updated.session.state : undefined).toBe("quality");
    expect(store.delete({ chatId: "123", messageId: 10 })).toBe(true);
    expect(store.delete({ chatId: "123", messageId: 10 })).toBe(false);
  });

  it("prunes expired sessions and does not log raw URLs", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const store = new TelegramMenuSessionStore({ ttlMs: 100, now: () => 100, logger });
    store.create({
      chatId: "123",
      messageId: 10,
      url: "https://example.com/video?token=secret",
      title: "Secret title",
      duration: 30,
      formatOptions: [option],
    });

    expect(store.pruneExpired(201)).toBe(1);
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("example.com");
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("Secret title");
  });

  it("derives callback session keys from Telegram messages", () => {
    expect(telegramMenuSessionKeyFromMessage({ message_id: 7, chat: { id: 42 } })).toEqual({
      chatId: "42",
      messageId: 7,
    });
    expect(telegramMenuSessionKeyFromMessage(undefined)).toBeUndefined();
  });
});

