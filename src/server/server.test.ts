import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "../core/jobs/in-memory-queue.js";
import { JobService } from "../core/jobs/job-service.js";
import type { DownloadJob } from "../core/jobs/queue.js";
import { buildWebhookUrl, loadServerConfig, validateWebhookSecret } from "./config.js";
import { createServerApp } from "./app.js";
import { TELEGRAM_ALLOWED_UPDATES, registerTelegramWebhook } from "./webhook-registration.js";

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
});
