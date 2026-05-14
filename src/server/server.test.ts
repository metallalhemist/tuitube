import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "../core/jobs/in-memory-queue.js";
import { JobService } from "../core/jobs/job-service.js";
import type { DownloadJob } from "../core/jobs/queue.js";
import {
  TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
} from "../adapters/telegram/upload-limits.js";
import { buildWebhookUrl, loadServerConfig, validateWebhookSecret } from "./config.js";
import { createServerApp } from "./app.js";
import { TELEGRAM_ALLOWED_UPDATES, registerTelegramWebhook } from "./webhook-registration.js";
import { TelegramMenuSessionStore } from "../adapters/telegram/menu-session-store.js";
import { createDownloadMenus } from "../adapters/telegram/menus/download-menu.js";
import { createTelegramProgressRuntime } from "./telegram-runtime.js";

const botInfo: UserFromGetMe = {
  id: 123,
  is_bot: true,
  first_name: "Tuitube",
  username: "tuitube_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

describe("server config and app", () => {
  it("loads bounded defaults and builds webhook URLs", () => {
    const config = loadServerConfig({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_WEBHOOK_SECRET: "secret_token",
      PATH: "/bin",
    });
    expect(config.maxConcurrentDownloads).toBe(1);
    expect(config.maxQueueSize).toBe(5);
    expect(buildWebhookUrl("https://example.com/base?token=secret", "/telegram/webhook")).toBe(
      "https://example.com/base/telegram/webhook",
    );
    expect(() => validateWebhookSecret("bad secret")).toThrow();
    expect(() =>
      loadServerConfig({
        TELEGRAM_BOT_TOKEN: "123:token",
        PATH: "/bin",
      }),
    ).toThrow("TELEGRAM_WEBHOOK_SECRET is required");
  });

  it("allows polling mode without webhook secret", () => {
    const config = loadServerConfig({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_UPDATE_MODE: "polling",
      PATH: "/bin",
    });

    expect(config.telegram.updateMode).toBe("polling");
    expect(config.telegram.webhookSecret).toBeUndefined();
  });

  it("normalizes Telegram API roots and derives upload mode", () => {
    const cloudConfig = loadServerConfig({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_WEBHOOK_SECRET: "secret_token",
      TELEGRAM_API_ROOT: "https://api.telegram.org/",
      PATH: "/bin",
    });
    expect(cloudConfig.telegram.apiRoot).toBe("https://api.telegram.org");
    expect(cloudConfig.telegram.uploadPolicy).toMatchObject({
      mode: "cloud",
      isLocalBotApiMode: false,
      limitBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
    });

    const localConfig = loadServerConfig({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_WEBHOOK_SECRET: "secret_token",
      TELEGRAM_API_ROOT: "http://127.0.0.1:18081///",
      PATH: "/bin",
    });
    expect(localConfig.telegram.apiRoot).toBe("http://127.0.0.1:18081");
    expect(localConfig.telegram.uploadPolicy).toMatchObject({
      mode: "local",
      isLocalBotApiMode: true,
      limitBytes: TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
    });

    expect(() =>
      loadServerConfig({
        TELEGRAM_BOT_TOKEN: "123:token",
        TELEGRAM_WEBHOOK_SECRET: "secret_token",
        TELEGRAM_API_ROOT: "http://127.0.0.1:18081/bot123:secret",
        PATH: "/bin",
      }),
    ).toThrow("/bot<TOKEN>");
  });

  it("keeps app factory injectable without startup side effects", async () => {
    const config = loadServerConfig({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_WEBHOOK_SECRET: "secret_token",
      PATH: "/bin",
    });
    const queue = new InMemoryJobQueue<DownloadJob>();
    const jobService = new JobService(queue);
    const app = createServerApp({
      config,
      bot: new Bot("123:token", { botInfo }),
      jobService,
    });

    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, status: "ok", queueSize: 0 });

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      payload: { update_id: 1 },
    });
    expect(webhookResponse.statusCode).toBe(401);

    const signedWebhookResponse = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "secret_token",
      },
      payload: { update_id: 1 },
    });
    expect(signedWebhookResponse.statusCode).toBe(200);
    await app.close();
  });

  it("registers webhook callback queries for menu callbacks", async () => {
    const setWebhook = vi.fn(async () => true);

    await registerTelegramWebhook({
      bot: { api: { setWebhook } } as never,
      webhookUrl: "https://example.com/telegram/webhook",
      webhookSecret: "secret_token",
    });

    expect(TELEGRAM_ALLOWED_UPDATES).toEqual(["message", "callback_query"]);
    expect(setWebhook).toHaveBeenCalledWith("https://example.com/telegram/webhook", {
      secret_token: "secret_token",
      allowed_updates: ["message", "callback_query"],
    });
  });

  it("composes Telegram progress runtime without startup side effects", async () => {
    const editMessageText = vi.fn(async () => undefined);
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 77,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [],
    });
    store.markProgress({ chatId: "123", messageId: 77 }, { activeJobId: "job-1", expectedSizeBytes: 2048 });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-1" })),
      onCancel: vi.fn(async () => undefined),
    });
    const runtime = createTelegramProgressRuntime({
      api: { editMessageText },
      store,
      menus,
    });

    await runtime.onJobProgress(
      {
        id: "job-1",
        action: "download_format",
        payload: { url: "https://example.com/video", menuMessageId: 77, expectedSizeBytes: 2048 },
        chatId: "123",
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { downloadedBytes: 1024, percent: 50 },
    );

    expect(editMessageText).toHaveBeenCalledWith(
      "123",
      77,
      expect.stringContaining("Скачивание запущено"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("removes progress cancellation controls when delivery enters sending", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 78,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [],
    });
    store.markProgress({ chatId: "123", messageId: 78 }, { activeJobId: "job-1", expectedSizeBytes: 2048 });
    const editMessageText = vi.fn(async () => {
      const lookup = store.get({ chatId: "123", messageId: 78 });
      expect(lookup.status === "found" ? lookup.session.state : undefined).toBe("sending");
    });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-1" })),
      onCancel: vi.fn(async () => undefined),
    });
    const runtime = createTelegramProgressRuntime({
      api: { editMessageText },
      store,
      menus,
    });

    await runtime.cleanup.markSending({
      id: "job-1",
      action: "download_format",
      payload: { url: "https://example.com/video", menuMessageId: 78, expectedSizeBytes: 2048 },
      chatId: "123",
      status: "sending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(editMessageText).toHaveBeenCalledWith(
      "123",
      78,
      expect.stringContaining("Отправляю"),
      expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );
    expect(store.get({ chatId: "123", messageId: 78 }).status).toBe("missing");
  });

  it("marks cancelled progress terminal and suppresses delayed updates", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 79,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [],
    });
    store.markProgress({ chatId: "123", messageId: 79 }, { activeJobId: "job-1", expectedSizeBytes: 2048 });
    const editMessageText = vi.fn(async () => undefined);
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-1" })),
      onCancel: vi.fn(async () => undefined),
    });
    const runtime = createTelegramProgressRuntime({
      api: { editMessageText },
      store,
      menus,
    });
    const job = {
      id: "job-1",
      action: "download_format" as const,
      payload: { url: "https://example.com/video", menuMessageId: 79, expectedSizeBytes: 2048 },
      chatId: "123",
      status: "cancelled" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await runtime.cleanup.markCancelled(job);
    await runtime.onJobProgress(job, { downloadedBytes: 1024, percent: 50 });

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith("123", 79, "Отменено.", {
      reply_markup: { inline_keyboard: [] },
    });
    expect(store.get({ chatId: "123", messageId: 79 }).status).toBe("missing");
  });
});
