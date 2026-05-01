import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InputFile } from "grammy";
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
  type TelegramUploadMode,
  type TelegramUploadPolicy,
} from "./upload-limits.js";

export type TelegramResultApi = {
  sendDocument(chatId: string, file: unknown, options?: { caption?: string }): Promise<unknown>;
  sendVideo(
    chatId: string,
    file: unknown,
    options?: { caption?: string; supports_streaming?: boolean },
  ): Promise<unknown>;
  sendMessage(chatId: string, text: string): Promise<unknown>;
};

type TelegramUploadFailureReason = "http_413" | "request_entity_too_large" | "file_too_big";

export class TelegramResultSender {
  constructor(
    private readonly options: {
      api: TelegramResultApi;
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
        uploadMode: uploadPolicy.mode,
        limitBytes: uploadPolicy.limitBytes,
        sizeBucket: sizeBucket(fileSizeBytes),
        reason: "configured_limit",
      });
      await this.notifyAlreadyAndThrow(
        job.chatId,
        telegramCopy.telegramUploadTooLarge(uploadPolicy.limitLabel, uploadPolicy.mode),
        "Telegram upload limit exceeded before upload",
      );
    }

    try {
      const file = new InputFile(result.filePath);
      const caption = `${telegramCopy.completed} ${result.title}`;
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
          uploadMode: uploadPolicy.mode,
          reason: tooLargeReason,
          statusCode: telegramErrorStatusCode(error),
        });
        await this.notifyAlreadyAndThrow(
          job.chatId,
          telegramCopy.telegramUploadTooLarge(uploadPolicy.limitLabel, uploadPolicy.mode),
          "Telegram upload failed because the file is too large",
          error,
        );
      }

      this.logger.error("telegram.result_sender.telegram_upload_failed", {
        jobId: job.id,
        action: job.action,
        mediaKind,
        uploadMode: uploadPolicy.mode,
        statusCode: telegramErrorStatusCode(error),
        error: sanitizeTelegramError(error),
      });
      await this.notifyAlreadyAndThrow(job.chatId, telegramCopy.sendingFileFailed, "Telegram upload failed", error);
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
    await this.options.api.sendMessage(job.chatId, jobFailedText(job.errorCode));
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
        error: sanitizeTelegramError(error),
      });
      if (job.chatId) {
        await this.notifyAlreadyAndThrow(
          job.chatId,
          telegramCopy.sendingFileFailed,
          "Could not inspect Telegram upload file",
          error,
        );
      }
      throw error;
    }
  }

  private async notifyAlreadyAndThrow(chatId: string, text: string, message: string, cause?: unknown): Promise<never> {
    try {
      await this.options.api.sendMessage(chatId, text);
    } catch (notificationError) {
      this.logger.warn("telegram.result_sender.notification_failed", {
        error: sanitizeTelegramError(notificationError),
      });
      if (cause instanceof Error) throw cause;
      if (notificationError instanceof Error) throw notificationError;
      throw new Error(message);
    }

    throw new TelegramResultAlreadyNotifiedError(message, { cause });
  }
}

function sizeBucket(bytes: number): string {
  if (bytes <= TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES) return "lte_cloud_limit";
  if (bytes <= TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES) return "cloud_to_local_limit";
  return "gt_local_limit";
}

function telegramErrorStatusCode(error: unknown): number | undefined {
  const record = error as {
    status?: unknown;
    statusCode?: unknown;
    error_code?: unknown;
    response?: { status?: unknown; statusCode?: unknown; error_code?: unknown };
  };
  const candidates = [
    record.status,
    record.statusCode,
    record.error_code,
    record.response?.status,
    record.response?.statusCode,
    record.response?.error_code,
  ];
  return candidates.find(
    (candidate): candidate is number => typeof candidate === "number" && Number.isFinite(candidate),
  );
}

function telegramErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const record = error as { description?: unknown; message?: unknown; response?: { description?: unknown } };
  if (typeof record.description === "string") return record.description;
  if (typeof record.response?.description === "string") return record.response.description;
  if (typeof record.message === "string") return record.message;
  return String(error);
}

function classifyTelegramUploadTooLarge(error: unknown): TelegramUploadFailureReason | undefined {
  if (telegramErrorStatusCode(error) === 413) return "http_413";

  const lowerText = telegramErrorText(error).toLowerCase();
  if (lowerText.includes("request entity too large")) return "request_entity_too_large";
  if (lowerText.includes("file is too big") || lowerText.includes("file too big")) return "file_too_big";
  return undefined;
}

function sanitizeTelegramError(error: unknown): string {
  return telegramErrorText(error)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 300);
}
