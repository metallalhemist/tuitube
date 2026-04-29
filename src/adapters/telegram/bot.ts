import { Bot, type Context } from "grammy";
import { normalizeError } from "../../core/errors.js";
import { isValidUrl } from "../../core/validation.js";
import { noopLogger, type Logger } from "../../core/logger.js";
import type { JobService } from "../../core/jobs/job-service.js";
import { telegramCopy } from "./copy.js";
import type { TelegramMenuContext } from "./context.js";
import type { DownloadMenus } from "./menus/download-menu.js";

export type CreateTelegramBotOptions = {
  botToken: string;
  apiRoot?: string;
  jobService: JobService;
  menus?: DownloadMenus;
  logger?: Logger;
};

function updateType(ctx: Context): string {
  if (ctx.message) return "message";
  if (ctx.callbackQuery) return "callback_query";
  if (ctx.inlineQuery) return "inline_query";
  return "unknown";
}

type TextMessageContext = Context & {
  message: {
    text: string;
  };
  chat: {
    id: number | string;
  };
};

export async function handleTelegramTextMessage(
  ctx: TextMessageContext,
  jobService: JobService,
  logger: Logger = noopLogger,
): Promise<void> {
  const text = ctx.message.text.trim();
  if (!isValidUrl(text)) {
    logger.warn("telegram.text.invalid_url");
    await ctx.reply(telegramCopy.invalidUrl);
    return;
  }

  await ctx.reply(telegramCopy.analyzingUrl);
  logger.info("telegram.metadata_prepare.acknowledged", { hasChatId: Boolean(ctx.chat.id) });

  try {
    const job = await jobService.createMediaJob({
      action: "prepare_metadata",
      payload: { url: text },
      chatId: String(ctx.chat.id),
    });
    logger.info("telegram.metadata_prepare.enqueued", { jobId: job.id, action: job.action, hasChatId: true });
  } catch (error) {
    const normalized = normalizeError(error, "Could not queue metadata job");
    const logDetails = { code: normalized.code, severity: normalized.severity };

    if (normalized.code === "QUEUE_FULL") {
      logger.warn("telegram.queue.rejected", logDetails);
      await ctx.reply(telegramCopy.queueFull);
      return;
    }

    logger.error("telegram.queue.failed", logDetails);
    await ctx.reply(telegramCopy.metadataFailed);
  }
}

export function createTelegramBot({
  botToken,
  apiRoot,
  jobService,
  menus,
  logger = noopLogger,
}: CreateTelegramBotOptions): Bot<TelegramMenuContext> {
  const bot = new Bot<TelegramMenuContext>(botToken, apiRoot ? { client: { apiRoot } } : undefined);

  bot.use(async (ctx, next) => {
    logger.info("telegram.update.received", { updateId: ctx.update.update_id, type: updateType(ctx) });
    await next();
  });

  if (menus) {
    logger.info("telegram.menu.install");
    bot.use(menus.rootMenu);
  }

  bot.command("start", async (ctx) => {
    logger.info("telegram.command.start");
    await ctx.reply(telegramCopy.start);
  });

  bot.on("message:text", async (ctx) => {
    logger.debug("telegram.text.route");
    await handleTelegramTextMessage(ctx, jobService, logger);
  });

  bot.catch((error) => {
    logger.error("telegram.bot.error", {
      error: error.error instanceof Error ? error.error.message : String(error.error),
      updateId: error.ctx.update.update_id,
    });
  });

  return bot;
}
