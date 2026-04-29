import { noopLogger, type Logger } from "../../core/logger.js";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { VideoSelectionSnapshot } from "../../core/types.js";
import { telegramCopy } from "./copy.js";
import type { TelegramMenuSessionStore } from "./menu-session-store.js";
import type { DownloadMenus } from "./menus/download-menu.js";

export type TelegramMetadataApi = {
  sendMessage(chatId: string, text: string): Promise<{ message_id: number }>;
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options?: { reply_markup?: { inline_keyboard: import("grammy/types").InlineKeyboardButton[][] } },
  ): Promise<unknown>;
};

export class TelegramMetadataResultDispatcher {
  constructor(
    private readonly options: {
      api: TelegramMetadataApi;
      store: TelegramMenuSessionStore;
      menus: Pick<DownloadMenus, "renderRootMenuMarkup">;
      logger?: Logger;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  async dispatchPrepared(job: MediaJob, snapshot: VideoSelectionSnapshot): Promise<void> {
    if (!job.chatId) {
      this.logger.warn("telegram.metadata_dispatch.skip_no_chat", { jobId: job.id });
      return;
    }

    this.logger.info("telegram.metadata_dispatch.start", { jobId: job.id, hasChatId: true });
    try {
      const sentMessage = await this.options.api.sendMessage(
        job.chatId,
        telegramCopy.mainMenuTitle(snapshot.title, snapshot.duration),
      );
      this.options.store.create({
        chatId: job.chatId,
        messageId: sentMessage.message_id,
        url: job.payload.url,
        title: snapshot.title,
        duration: snapshot.duration,
        formatOptions: snapshot.formatOptions,
      });

      const replyMarkup = await this.options.menus.renderRootMenuMarkup(job.chatId, sentMessage.message_id);
      await this.options.api.editMessageText(
        job.chatId,
        sentMessage.message_id,
        telegramCopy.mainMenuTitle(snapshot.title, snapshot.duration),
        { reply_markup: replyMarkup },
      );

      this.logger.info("telegram.metadata_dispatch.finish", {
        jobId: job.id,
        messageId: sentMessage.message_id,
      });
    } catch (error) {
      this.logger.error("telegram.metadata_dispatch.failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async dispatchFailed(job: MediaJob): Promise<void> {
    if (!job.chatId) return;
    this.logger.warn("telegram.metadata_dispatch.preparation_failed", { jobId: job.id, code: job.errorCode });
    await this.options.api.sendMessage(job.chatId, telegramCopy.metadataFailed);
  }
}
