import type { InlineKeyboardButton } from "grammy/types";
import type { MediaJob } from "../../core/jobs/queue.js";
import { noopLogger, type Logger } from "../../core/logger.js";
import type { TelegramMenuSessionStore } from "./menu-session-store.js";
import { renderTelegramTerminalProgressText } from "./progress-message.js";
import type {
  TelegramDownloadProgressDispatcher,
  TelegramProgressTerminalState,
} from "./download-progress-dispatcher.js";
import { sanitizeTelegramError, telegramErrorReasonCode, telegramErrorStatusCode } from "./telegram-error.js";
import { telegramCopy } from "./copy.js";

const emptyReplyMarkup = { inline_keyboard: [] };

export type TelegramProgressCleanupApi = {
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options?: { reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } },
  ): Promise<unknown>;
};

export class TelegramProgressCleanup {
  constructor(
    private readonly options: {
      api: TelegramProgressCleanupApi;
      store: TelegramMenuSessionStore;
      dispatcher: TelegramDownloadProgressDispatcher;
      logger?: Logger;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  async markCompleted(job: MediaJob, options: { editOriginalMessage?: boolean } = {}): Promise<void> {
    await this.markTerminal(job, "completed", {
      editOriginalMessage: options.editOriginalMessage ?? true,
      text: renderTelegramTerminalProgressText("completed"),
    });
  }

  async markFailed(job: MediaJob, text = renderTelegramTerminalProgressText("failed")): Promise<boolean> {
    return this.markTerminal(job, "failed", { editOriginalMessage: true, text });
  }

  async markCancelled(job: MediaJob, text = renderTelegramTerminalProgressText("cancelled")): Promise<boolean> {
    return this.markTerminal(job, "cancelled", { editOriginalMessage: true, text });
  }

  async markSending(job: MediaJob): Promise<boolean> {
    const hasMenuMessage = Boolean(job.chatId && job.payload.menuMessageId);
    this.logger.info("telegram.progress_cleanup.accepted", {
      jobId: job.id,
      action: job.action,
      state: "sending",
      hasMenuMessage,
    });
    if (job.chatId && job.payload.menuMessageId) {
      const updated = this.options.store.update(
        { chatId: job.chatId, messageId: job.payload.menuMessageId },
        { state: "sending", activeJobId: job.id },
      );
      this.logger.debug("telegram.progress_cleanup.sending_session_mark", {
        jobId: job.id,
        messageId: job.payload.menuMessageId,
        status: updated.status,
      });
    }
    this.options.dispatcher.markTerminal(job.id, "sending");

    let edited = false;
    if (job.chatId && job.payload.menuMessageId) {
      await this.options.dispatcher.runExclusive(job.id, async () => {
        try {
          await this.options.api.editMessageText(job.chatId!, job.payload.menuMessageId!, telegramCopy.sendingFile, {
            reply_markup: emptyReplyMarkup,
          });
          edited = true;
        } catch (error) {
          this.logger.warn("telegram.progress_cleanup.sending_edit_failed", {
            jobId: job.id,
            action: job.action,
            messageId: job.payload.menuMessageId,
            statusCode: telegramErrorStatusCode(error),
            reason: telegramErrorReasonCode(error),
            error: sanitizeTelegramError(error),
          });
        }
      });
    }

    this.deleteSession(job);
    return edited;
  }

  deleteSession(job: MediaJob): boolean {
    if (!job.chatId || !job.payload.menuMessageId) return false;
    const deleted = this.options.store.delete({ chatId: job.chatId, messageId: job.payload.menuMessageId });
    this.logger.debug("telegram.progress_cleanup.session_delete", {
      jobId: job.id,
      messageId: job.payload.menuMessageId,
      deleted,
    });
    return deleted;
  }

  private async markTerminal(
    job: MediaJob,
    state: TelegramProgressTerminalState,
    options: { editOriginalMessage: boolean; text: string },
  ): Promise<boolean> {
    const hasMenuMessage = Boolean(job.chatId && job.payload.menuMessageId);
    this.logger.info("telegram.progress_cleanup.accepted", {
      jobId: job.id,
      action: job.action,
      state,
      hasMenuMessage,
    });
    this.options.dispatcher.markTerminal(job.id, state);

    let edited = false;
    if (job.chatId && job.payload.menuMessageId && options.editOriginalMessage) {
      await this.options.dispatcher.runExclusive(job.id, async () => {
        try {
          await this.options.api.editMessageText(job.chatId!, job.payload.menuMessageId!, options.text, {
            reply_markup: emptyReplyMarkup,
          });
          edited = true;
        } catch (error) {
          this.logger.warn("telegram.progress_cleanup.edit_failed", {
            jobId: job.id,
            action: job.action,
            state,
            messageId: job.payload.menuMessageId,
            statusCode: telegramErrorStatusCode(error),
            reason: telegramErrorReasonCode(error),
            error: sanitizeTelegramError(error),
          });
        }
      });
    }

    this.deleteSession(job);
    return edited || (hasMenuMessage && !options.editOriginalMessage);
  }
}
