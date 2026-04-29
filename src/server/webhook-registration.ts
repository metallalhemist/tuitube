import type { Bot } from "grammy";
import { noopLogger, type Logger } from "../core/logger.js";
import { redactWebhookUrl } from "./config.js";

export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;

export async function registerTelegramWebhook({
  bot,
  webhookUrl,
  webhookSecret,
  logger = noopLogger,
}: {
  bot: Pick<Bot, "api">;
  webhookUrl: string;
  webhookSecret?: string;
  logger?: Logger;
}): Promise<void> {
  logger.info("telegram.webhook.register.start", {
    webhookUrl: redactWebhookUrl(webhookUrl),
    allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES],
  });
  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret,
    allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
  });
  logger.info("telegram.webhook.register.finish", { webhookUrl: redactWebhookUrl(webhookUrl) });
}

