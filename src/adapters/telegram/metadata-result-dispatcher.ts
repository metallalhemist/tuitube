import { noopLogger, type Logger } from "../../core/logger.js";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { SerializableFormatOption, VideoSelectionSnapshot } from "../../core/types.js";
import { isFirstScreenMp4Option } from "../../core/format-selection.js";
import { telegramCopy } from "./copy.js";
import type { TelegramMenuSessionStore } from "./menu-session-store.js";
import type { DownloadMenus } from "./menus/download-menu.js";
import { telegramDisplayPolicyForOption } from "./telegram-policy.js";
import { createTelegramUploadPolicy, type TelegramUploadPolicy } from "./upload-limits.js";

export type TelegramMetadataApi = {
  sendMessage(chatId: string, text: string): Promise<{ message_id: number }>;
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options?: { reply_markup?: { inline_keyboard: import("grammy/types").InlineKeyboardButton[][] } },
  ): Promise<unknown>;
};

function formatContainerSummary(options: SerializableFormatOption[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const option of options) {
    const container = option.container ?? option.extension;
    summary[container] = (summary[container] ?? 0) + 1;
  }
  return summary;
}

export class TelegramMetadataResultDispatcher {
  constructor(
    private readonly options: {
      api: TelegramMetadataApi;
      store: TelegramMenuSessionStore;
      menus: Pick<DownloadMenus, "renderRootMenuMarkup">;
      uploadPolicy?: TelegramUploadPolicy;
      logger?: Logger;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  private get uploadPolicy(): TelegramUploadPolicy {
    return this.options.uploadPolicy ?? createTelegramUploadPolicy(undefined);
  }

  async dispatchPrepared(job: MediaJob, snapshot: VideoSelectionSnapshot): Promise<void> {
    if (!job.chatId) {
      this.logger.warn("telegram.metadata_dispatch.skip_no_chat", { jobId: job.id });
      return;
    }

    this.logger.info("telegram.metadata_dispatch.start", { jobId: job.id, hasChatId: true });
    try {
      const uploadPolicy = this.uploadPolicy;
      const hasMp4WithoutRecoding = snapshot.formatOptions.some((option) => {
        const displayPolicy = telegramDisplayPolicyForOption(option, uploadPolicy);
        return isFirstScreenMp4Option(option) && !option.disabled && !displayPolicy.disabled;
      });
      for (const option of snapshot.formatOptions) {
        const displayPolicy = telegramDisplayPolicyForOption(option, uploadPolicy);
        this.logger.debug("telegram.metadata_dispatch.upload_policy", {
          jobId: job.id,
          uploadMode: uploadPolicy.mode,
          limitBytes: uploadPolicy.limitBytes,
          optionId: option.id,
          reason: displayPolicy.reason,
          disabled: displayPolicy.disabled,
        });
      }
      this.logger.info("telegram.metadata_dispatch.formats", {
        jobId: job.id,
        formatCount: snapshot.formatOptions.length,
        containers: formatContainerSummary(snapshot.formatOptions),
        mp4Count: snapshot.formatOptions.filter((option) => (option.container ?? option.extension) === "mp4").length,
        firstScreenMp4Count: snapshot.formatOptions.filter(isFirstScreenMp4Option).length,
      });
      const messageText = telegramCopy.mainMenuTitle(snapshot.title, snapshot.duration, { hasMp4WithoutRecoding });
      const sentMessage = await this.options.api.sendMessage(
        job.chatId,
        messageText,
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
        messageText,
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
