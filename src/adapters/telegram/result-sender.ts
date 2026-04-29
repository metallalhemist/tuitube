import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InputFile } from "grammy";
import { noopLogger, type Logger } from "../../core/logger.js";
import type { MediaJob } from "../../core/jobs/queue.js";
import type { TranscriptResult } from "../../core/services/transcript-service.js";
import type { DownloadResult } from "../../core/types.js";
import { sanitizeVideoTitle } from "../../core/sanitize.js";
import { jobFailedText, telegramCopy, transcriptDeliveryMode } from "./copy.js";

export type TelegramResultApi = {
  sendDocument(chatId: string, file: unknown, options?: { caption?: string }): Promise<unknown>;
  sendMessage(chatId: string, text: string): Promise<unknown>;
};

export class TelegramResultSender {
  constructor(
    private readonly options: {
      api: TelegramResultApi;
      logger?: Logger;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  async sendDownload(job: MediaJob, result: DownloadResult): Promise<void> {
    if (!job.chatId) {
      this.logger.warn("telegram.result_sender.skip_no_chat", { jobId: job.id, action: job.action });
      return;
    }

    this.logger.info("telegram.result_sender.download.start", {
      jobId: job.id,
      action: job.action,
      fileName: result.fileName,
    });
    try {
      await this.options.api.sendDocument(job.chatId, new InputFile(result.filePath), {
        caption: `${telegramCopy.completed} ${result.title}`,
      });
      this.logger.info("telegram.result_sender.download.finish", { jobId: job.id, action: job.action });
    } catch (error) {
      this.logger.error("telegram.result_sender.download.failed", {
        jobId: job.id,
        action: job.action,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.options.api.sendMessage(job.chatId, telegramCopy.sendingFileFailed).catch(() => undefined);
      throw error;
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
        error: error instanceof Error ? error.message : String(error),
      });
      await this.options.api.sendMessage(job.chatId, jobFailedText(undefined)).catch(() => undefined);
      throw error;
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
}

