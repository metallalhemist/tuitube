import { Bot, type Context } from "grammy";
import { normalizeError } from "../../core/errors.js";
import { isValidUrl } from "../../core/validation.js";
import { noopLogger, type Logger } from "../../core/logger.js";
import type { JobService } from "../../core/jobs/job-service.js";

export type CreateTelegramBotOptions = {
  botToken: string;
  apiRoot?: string;
  jobService: JobService;
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
    await ctx.reply("Send a supported video URL to queue a download.");
    return;
  }

  try {
    const job = await jobService.createDownloadJob({
      url: text,
      chatId: String(ctx.chat.id),
    });
    await ctx.reply(`Queued download job ${job.id}.`);
  } catch (error) {
    const normalized = normalizeError(error, "Could not queue download job");
    const logDetails = { code: normalized.code, severity: normalized.severity };

    if (normalized.code === "QUEUE_FULL") {
      logger.warn("telegram.queue.rejected", logDetails);
      await ctx.reply("Download queue is full. Try again later.");
      return;
    }

    logger.error("telegram.queue.failed", logDetails);
    await ctx.reply("Could not queue this download right now. Try again later.");
  }
}

export function createTelegramBot({
  botToken,
  apiRoot,
  jobService,
  logger = noopLogger,
}: CreateTelegramBotOptions): Bot {
  const bot = new Bot(botToken, apiRoot ? { client: { apiRoot } } : undefined);

  bot.use(async (ctx, next) => {
    logger.info("telegram.update.received", { updateId: ctx.update.update_id, type: updateType(ctx) });
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("Tuitube backend is running. Send a video URL to queue a download.");
  });

  bot.on("message:text", async (ctx) => {
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
