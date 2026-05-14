import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InputFile, InputMediaBuilder } from "grammy";
import { noopLogger, type Logger } from "../../core/logger.js";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { TranscriptResult } from "../../core/services/transcript-service.js";
import type { DownloadResult } from "../../core/types.js";
import { sanitizeVideoTitle } from "../../core/sanitize.js";
import { jobFailedText, telegramCopy, transcriptDeliveryMode } from "./copy.js";
import { TelegramResultAlreadyNotifiedError } from "./result-errors.js";
import {
  createTelegramUploadPolicy,
  TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
  type TelegramUploadPolicy,
} from "./upload-limits.js";
import {
  sanitizeTelegramError,
  telegramErrorReasonCode,
  telegramErrorStatusCode,
  telegramErrorText,
} from "./telegram-error.js";

export type TelegramResultApi = {
  sendDocument(chatId: string, file: unknown, options?: { caption?: string }): Promise<unknown>;
  sendVideo(
    chatId: string,
    file: unknown,
    options?: { caption?: string; supports_streaming?: boolean },
  ): Promise<unknown>;
  sendMessage(chatId: string, text: string): Promise<unknown>;
  editMessageMedia?(
    chatId: string,
    messageId: number,
    media: unknown,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  editMessageReplyMarkup?(
    chatId: string,
    messageId: number,
    options?: { reply_markup?: { inline_keyboard: import("grammy/types").InlineKeyboardButton[][] } },
  ): Promise<unknown>;
  editMessageText?(
    chatId: string,
    messageId: number,
    text: string,
    options?: { reply_markup?: { inline_keyboard: import("grammy/types").InlineKeyboardButton[][] } },
  ): Promise<unknown>;
};

export type TelegramResultProgressHooks = {
  markCompleted(job: MediaJob, options?: { editOriginalMessage?: boolean }): Promise<void>;
  markFailed(job: MediaJob, text?: string): Promise<boolean>;
};

type TelegramUploadFailureReason = "http_413" | "request_entity_too_large" | "file_too_big";

export class TelegramResultSender {
  constructor(
    private readonly options: {
      api: TelegramResultApi;
      uploadPolicy?: TelegramUploadPolicy;
      progressHooks?: TelegramResultProgressHooks;
      logger?: Logger;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  private get uploadPolicy(): TelegramUploadPolicy {
    return this.options.uploadPolicy ?? createTelegramUploadPolicy(undefined);
  }

  async sendDownload(job: MediaJob, result: DownloadResult): Promise<void> {
    if (!job.chatId) {
      this.logger.warn("telegram.result_sender.skip_no_chat", { jobId: job.id, action: job.action });
      return;
    }

    const extension = path.extname(result.filePath).toLowerCase();
    const mediaKind = extension === ".mp4" ? "video" : "document";
    const uploadPolicy = this.uploadPolicy;
    this.logger.info("telegram.result_sender.download.start", {
      jobId: job.id,
      action: job.action,
      mediaKind,
      extension,
      uploadMode: uploadPolicy.mode,
    });

    const fileSizeBytes = await this.getFileSizeBytes(job, result.filePath);
    this.logger.debug("telegram.result_sender.upload_limit_decision", {
      jobId: job.id,
      action: job.action,
      mediaKind,
      uploadMode: uploadPolicy.mode,
      limitBytes: uploadPolicy.limitBytes,
      sizeBucket: sizeBucket(fileSizeBytes),
      allowed: fileSizeBytes <= uploadPolicy.limitBytes,
    });

    if (fileSizeBytes > uploadPolicy.limitBytes) {
      this.logger.warn("telegram.result_sender.upload_too_large", {
        jobId: job.id,
        action: job.action,
        mediaKind,
        extension,
        uploadMode: uploadPolicy.mode,
        limitBytes: uploadPolicy.limitBytes,
        sizeBucket: sizeBucket(fileSizeBytes),
        reason: "configured_limit",
      });
      await this.notifyDownloadFailure(
        job,
        telegramCopy.telegramUploadTooLarge(uploadPolicy.limitLabel, uploadPolicy.mode),
        "Telegram upload limit exceeded before upload",
      );
    }

    try {
      const file = new InputFile(result.filePath);
      const caption = `${telegramCopy.completed} ${result.title}`;
      if (mediaKind === "video" && job.payload.menuMessageId && this.options.api.editMessageMedia) {
        try {
          this.logger.info("telegram.result_sender.edit_media.start", {
            jobId: job.id,
            mediaKind,
            messageId: job.payload.menuMessageId,
            uploadMode: uploadPolicy.mode,
            sizeBucket: sizeBucket(fileSizeBytes),
          });
          await this.options.api.editMessageMedia(
            job.chatId,
            job.payload.menuMessageId,
            InputMediaBuilder.video(file, { caption, supports_streaming: true }),
          );
          try {
            await this.options.api.editMessageReplyMarkup?.(job.chatId, job.payload.menuMessageId);
          } catch (error) {
            this.logger.warn("telegram.result_sender.edit_media_markup_clear_failed", {
              jobId: job.id,
              mediaKind,
              messageId: job.payload.menuMessageId,
              statusCode: telegramErrorStatusCode(error),
              reason: telegramErrorReasonCode(error),
              error: sanitizeTelegramError(error),
            });
          }
          await this.options.progressHooks?.markCompleted(job, { editOriginalMessage: false });
          this.logger.info("telegram.result_sender.edit_media.finish", {
            jobId: job.id,
            mediaKind,
            messageId: job.payload.menuMessageId,
            uploadMode: uploadPolicy.mode,
            sizeBucket: sizeBucket(fileSizeBytes),
          });
          return;
        } catch (error) {
          this.logger.warn("telegram.result_sender.edit_media_fallback", {
            jobId: job.id,
            mediaKind,
            messageId: job.payload.menuMessageId,
            statusCode: telegramErrorStatusCode(error),
            reason: telegramErrorReasonCode(error),
            error: sanitizeTelegramError(error),
          });
        }
      }

      if (mediaKind === "video") {
        await this.options.api.sendVideo(job.chatId, file, {
          caption,
          supports_streaming: true,
        });
      } else {
        await this.options.api.sendDocument(job.chatId, file, {
          caption,
        });
      }
      await this.options.progressHooks?.markCompleted(job, { editOriginalMessage: Boolean(job.payload.menuMessageId) });
      this.logger.info("telegram.result_sender.download.finish", {
        jobId: job.id,
        action: job.action,
        mediaKind,
        uploadMode: uploadPolicy.mode,
        sizeBucket: sizeBucket(fileSizeBytes),
      });
    } catch (error) {
      const tooLargeReason = classifyTelegramUploadTooLarge(error);
      if (tooLargeReason) {
        this.logger.warn("telegram.result_sender.telegram_upload_too_large", {
          jobId: job.id,
          action: job.action,
          mediaKind,
          extension,
          uploadMode: uploadPolicy.mode,
          sizeBucket: sizeBucket(fileSizeBytes),
          reason: tooLargeReason,
          statusCode: telegramErrorStatusCode(error),
        });
        await this.notifyDownloadFailure(
          job,
          telegramCopy.telegramUploadTooLarge(uploadPolicy.limitLabel, uploadPolicy.mode),
          "Telegram upload failed because the file is too large",
          error,
        );
      }

      this.logger.error("telegram.result_sender.telegram_upload_failed", {
        jobId: job.id,
        action: job.action,
        mediaKind,
        extension,
        uploadMode: uploadPolicy.mode,
        sizeBucket: sizeBucket(fileSizeBytes),
        statusCode: telegramErrorStatusCode(error),
        reason: telegramErrorReasonCode(error),
        error: sanitizeTelegramError(error),
      });
      await this.notifyDownloadFailure(job, telegramCopy.sendingFileFailed, "Telegram upload failed", error);
    }
  }

  async sendTranscript(job: MediaJob, result: TranscriptResult): Promise<void> {
    if (!job.chatId) {
      this.logger.warn("telegram.result_sender.transcript.skip_no_chat", { jobId: job.id });
      return;
    }

    const mode = transcriptDeliveryMode(result.transcript);
    this.logger.info("telegram.result_sender.transcript.start", { jobId: job.id, mode });

    if (mode === "message") {
      await this.options.api.sendMessage(job.chatId, result.transcript);
      this.logger.info("telegram.result_sender.transcript.finish", { jobId: job.id, mode });
      return;
    }

    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "tuitube-transcript-"));
    const filePath = path.join(tempDirectory, `${sanitizeVideoTitle(result.title) || "transcript"}.txt`);
    try {
      await writeFile(filePath, result.transcript, "utf-8");
      this.logger.debug("telegram.result_sender.transcript.document", { jobId: job.id });
      await this.options.api.sendDocument(job.chatId, new InputFile(filePath), {
        caption: telegramCopy.transcriptDocumentCaption,
      });
      this.logger.info("telegram.result_sender.transcript.finish", { jobId: job.id, mode });
    } catch (error) {
      this.logger.error("telegram.result_sender.transcript.failed", {
        jobId: job.id,
        reason: telegramErrorReasonCode(error),
        error: sanitizeTelegramError(error),
      });
      await this.notifyAlreadyAndThrow(
        job.chatId,
        jobFailedText(undefined),
        "Telegram transcript delivery failed",
        error,
      );
    } finally {
      this.logger.debug("telegram.result_sender.transcript.cleanup", { jobId: job.id });
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  async sendFailure(job: MediaJob): Promise<void> {
    if (!job.chatId) return;
    this.logger.warn("telegram.result_sender.failure", { jobId: job.id, action: job.action, code: job.errorCode });
    if (await this.options.progressHooks?.markFailed(job, jobFailedText(job.errorCode))) return;
    try {
      await this.options.api.sendMessage(job.chatId, jobFailedText(job.errorCode));
    } catch (error) {
      this.logger.warn("telegram.result_sender.failure_notification_failed", {
        jobId: job.id,
        action: job.action,
        statusCode: telegramErrorStatusCode(error),
        reason: telegramErrorReasonCode(error),
        error: sanitizeTelegramError(error),
      });
      throw new Error("Telegram failure notification failed");
    }
  }

  private async getFileSizeBytes(job: MediaJob, filePath: string): Promise<number> {
    try {
      const fileStat = await stat(filePath);
      this.logger.debug("telegram.result_sender.stat.finish", {
        jobId: job.id,
        action: job.action,
        sizeBucket: sizeBucket(fileStat.size),
      });
      return fileStat.size;
    } catch (error) {
      this.logger.error("telegram.result_sender.stat.failed", {
        jobId: job.id,
        action: job.action,
        extension: path.extname(filePath).toLowerCase(),
        reason: telegramErrorReasonCode(error),
        error: sanitizeTelegramError(error),
      });
      await this.notifyDownloadFailure(
        job,
        telegramCopy.sendingFileFailed,
        "Could not inspect Telegram upload file",
        error,
      );
      throw error;
    }
  }

  private async notifyDownloadFailure(job: MediaJob, text: string, message: string, cause?: unknown): Promise<never> {
    if (job.chatId && (await this.options.progressHooks?.markFailed(job, text))) {
      throw new TelegramResultAlreadyNotifiedError(message, {
        reason: cause ? telegramErrorReasonCode(cause) : undefined,
      });
    }

    if (!job.chatId) throw new Error(message);
    return await this.notifyAlreadyAndThrow(job.chatId, text, message, cause);
  }

  private async notifyAlreadyAndThrow(chatId: string, text: string, message: string, cause?: unknown): Promise<never> {
    try {
      await this.options.api.sendMessage(chatId, text);
    } catch (notificationError) {
      this.logger.warn("telegram.result_sender.notification_failed", {
        statusCode: telegramErrorStatusCode(notificationError),
        reason: telegramErrorReasonCode(notificationError),
        originalReason: cause ? telegramErrorReasonCode(cause) : undefined,
        error: sanitizeTelegramError(notificationError),
      });
      throw new Error(`${message}; Telegram failure notification failed`);
    }

    throw new TelegramResultAlreadyNotifiedError(message, {
      reason: cause ? telegramErrorReasonCode(cause) : undefined,
    });
  }
}

function sizeBucket(bytes: number): string {
  if (bytes <= TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES) return "lte_cloud_limit";
  if (bytes <= TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES) return "cloud_to_local_limit";
  return "gt_local_limit";
}

function classifyTelegramUploadTooLarge(error: unknown): TelegramUploadFailureReason | undefined {
  if (telegramErrorStatusCode(error) === 413) return "http_413";

  const lowerText = telegramErrorText(error).toLowerCase();
  if (lowerText.includes("request entity too large")) return "request_entity_too_large";
  if (lowerText.includes("file is too big") || lowerText.includes("file too big")) return "file_too_big";
  return undefined;
}
