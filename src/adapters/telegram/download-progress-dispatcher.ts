import type { InlineKeyboardButton } from "grammy/types";
import type { DownloadProgress } from "../../core/download-progress.js";
import type { MediaJob } from "../../core/jobs/queue.js";
import { noopLogger, type Logger } from "../../core/logger.js";
import { renderTelegramDownloadProgressText, type TelegramProgressView } from "./progress-message.js";
import { sanitizeTelegramError, telegramErrorReasonCode, telegramErrorStatusCode } from "./telegram-error.js";
import { formatTelegramProgressBytes } from "./copy.js";

export type TelegramProgressApi = {
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options?: { reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } },
  ): Promise<unknown>;
};

export type TelegramProgressTerminalState = "completed" | "failed" | "cancelled";
export type TelegramProgressSuppressionState = TelegramProgressTerminalState | "sending";

type ProgressState = {
  lastSentAt?: number;
  lastPercentInteger?: number;
  lastDownloadedLabel?: string;
  visiblePercent?: number;
  visibleDownloadedBytes: number;
  downloadedIsEstimated?: boolean;
  completedStageBytes: number;
  currentStageDownloadedBytes: number;
  previousDownloadedBytes?: number;
  previousTotalBytes?: number;
  previousPercent?: number;
};

export class TelegramDownloadProgressDispatcher {
  private readonly progressStates = new Map<string, ProgressState>();
  private readonly terminalJobs = new Map<string, number>();
  private readonly editChains = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      api: TelegramProgressApi;
      renderReplyMarkup: (job: MediaJob) => Promise<{ inline_keyboard: InlineKeyboardButton[][] } | undefined>;
      logger?: Logger;
      now?: () => number;
      minIntervalMs?: number;
      terminalTtlMs?: number;
      terminalMaxEntries?: number;
    },
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? noopLogger;
  }

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  async dispatch(job: MediaJob, progress: DownloadProgress, options: { force?: boolean } = {}): Promise<void> {
    this.pruneTerminalJobs();

    if (this.terminalJobs.has(job.id)) {
      this.logger.debug("telegram.progress_dispatch.skip", { jobId: job.id, action: job.action, reason: "terminal" });
      return;
    }

    const chatId = job.chatId;
    const messageId = job.payload.menuMessageId;
    if (!chatId || !messageId) {
      this.logger.debug("telegram.progress_dispatch.skip", {
        jobId: job.id,
        action: job.action,
        reason: "missing_menu_message",
      });
      return;
    }

    await this.runExclusive(job.id, async () => {
      if (this.terminalJobs.has(job.id)) {
        this.logger.debug("telegram.progress_dispatch.skip", {
          jobId: job.id,
          action: job.action,
          reason: "terminal",
        });
        return;
      }

      const { view: nextView, state: nextState } = this.normalizeProgressState(job, progress);
      const nextPercentInteger =
        typeof nextView.visiblePercent === "number" ? Math.floor(nextView.visiblePercent) : undefined;
      const nextDownloadedLabel = formatTelegramProgressBytes(nextView.visibleDownloadedBytes);
      const state = this.progressStates.get(job.id);

      if (!options.force && state) {
        const hasProgressChange = nextPercentInteger !== undefined && nextPercentInteger !== state.lastPercentInteger;
        const hasDownloadedLabelChange = nextDownloadedLabel !== state.lastDownloadedLabel;
        if (!hasProgressChange && !hasDownloadedLabelChange) {
          this.logger.debug("telegram.progress_dispatch.skip", {
            jobId: job.id,
            action: job.action,
            reason: "duplicate_progress",
          });
          return;
        }

        const elapsed = this.now - (state.lastSentAt ?? 0);
        if (elapsed < (this.options.minIntervalMs ?? 1_000)) {
          this.progressStates.set(job.id, {
            ...nextState,
            lastSentAt: state.lastSentAt,
            lastPercentInteger: state.lastPercentInteger,
            lastDownloadedLabel: state.lastDownloadedLabel,
          });
          this.logger.debug("telegram.progress_dispatch.skip", {
            jobId: job.id,
            action: job.action,
            reason: "throttled",
          });
          return;
        }
      }

      const replyMarkup = await this.options.renderReplyMarkup(job);
      if (this.terminalJobs.has(job.id)) {
        this.logger.debug("telegram.progress_dispatch.skip", {
          jobId: job.id,
          action: job.action,
          reason: "terminal_after_markup",
        });
        return;
      }

      const sentAt = this.now;
      this.progressStates.set(job.id, {
        ...nextState,
        lastSentAt: sentAt,
        lastPercentInteger: nextPercentInteger,
        lastDownloadedLabel: nextDownloadedLabel,
      });

      try {
        await this.options.api.editMessageText(
          chatId,
          messageId,
          renderTelegramDownloadProgressText(nextView),
          replyMarkup ? { reply_markup: replyMarkup } : undefined,
        );
        this.logger.info("telegram.progress_dispatch.sent", {
          jobId: job.id,
          percent: nextView.visiblePercent,
          downloadedBytes: nextView.visibleDownloadedBytes,
          totalBytes: nextView.displayedTotalBytes,
          messageId,
        });
      } catch (error) {
        this.logger.warn("telegram.progress_dispatch.edit_failed", {
          jobId: job.id,
          action: job.action,
          messageId,
          statusCode: telegramErrorStatusCode(error),
          reason: telegramErrorReasonCode(error),
          error: sanitizeTelegramError(error),
        });
      }
    });
  }

  clear(jobId: string): void {
    const deleted = this.progressStates.delete(jobId);
    this.logger.debug("telegram.progress_dispatch.clear", { jobId, deleted });
  }

  markTerminal(jobId: string, state: TelegramProgressSuppressionState): void {
    this.clear(jobId);
    this.terminalJobs.set(jobId, this.now + (this.options.terminalTtlMs ?? 10 * 60 * 1000));
    this.pruneTerminalJobs();
    this.logger.info("telegram.progress_dispatch.terminal", { jobId, state });
  }

  async runExclusive<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.editChains.get(jobId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tracked = current.then(
      () => undefined,
      () => undefined,
    );
    this.editChains.set(jobId, tracked);

    try {
      return await current;
    } finally {
      if (this.editChains.get(jobId) === tracked) {
        this.editChains.delete(jobId);
      }
    }
  }

  private normalizeProgressState(
    job: MediaJob,
    progress: DownloadProgress,
  ): { view: TelegramProgressView; state: ProgressState } {
    const previous = this.progressStates.get(job.id);
    const displayedTotalBytes =
      validBytes(job.payload.expectedSizeBytes) ??
      validBytes(progress.totalBytes) ??
      validBytes(progress.totalBytesEstimate);
    const currentStageTotalBytes = validBytes(progress.totalBytes) ?? validBytes(progress.totalBytesEstimate);
    const rawPercent =
      typeof progress.percent === "number" && Number.isFinite(progress.percent)
        ? Math.min(99, Math.max(0, progress.percent))
        : undefined;
    const rawDownloadedBytes = validBytes(progress.downloadedBytes);
    const previousDownloadedBytes = previous?.previousDownloadedBytes;
    const previousPercent = previous?.previousPercent;
    const downloadedReset =
      rawDownloadedBytes !== undefined &&
      previousDownloadedBytes !== undefined &&
      rawDownloadedBytes < previousDownloadedBytes &&
      rawDownloadedBytes <= previousDownloadedBytes * 0.5;
    const percentReset =
      rawPercent !== undefined && previousPercent !== undefined && rawPercent + 20 < previousPercent;
    const stageReset = Boolean(previous && (downloadedReset || percentReset));

    let downloadedIsEstimated = false;
    let completedStageBytes = previous?.completedStageBytes ?? 0;
    if (stageReset) {
      completedStageBytes += previous?.currentStageDownloadedBytes ?? previousDownloadedBytes ?? 0;
      this.logger.debug("telegram.progress_dispatch.stage_reset", {
        jobId: job.id,
        action: job.action,
        completedStageBytes,
        previousDownloadedBytes,
        downloadedBytes: rawDownloadedBytes,
        previousPercent,
        percent: rawPercent,
      });
    }

    let currentStageDownloadedBytes = rawDownloadedBytes;
    if (
      currentStageDownloadedBytes === undefined &&
      currentStageTotalBytes !== undefined &&
      rawPercent !== undefined
    ) {
      currentStageDownloadedBytes = Math.floor((currentStageTotalBytes * rawPercent) / 100);
      downloadedIsEstimated = true;
    }
    if (
      currentStageDownloadedBytes === undefined &&
      !previous?.completedStageBytes &&
      displayedTotalBytes !== undefined &&
      rawPercent !== undefined
    ) {
      currentStageDownloadedBytes = Math.floor((displayedTotalBytes * rawPercent) / 100);
      downloadedIsEstimated = true;
    }

    if (!stageReset && previous && currentStageDownloadedBytes !== undefined) {
      currentStageDownloadedBytes = Math.max(previous.currentStageDownloadedBytes, currentStageDownloadedBytes);
    }
    if (currentStageDownloadedBytes === undefined) {
      currentStageDownloadedBytes = stageReset ? 0 : (previous?.currentStageDownloadedBytes ?? 0);
    }

    const rawVisibleDownloadedBytes = completedStageBytes + currentStageDownloadedBytes;
    const cappedDownloaded =
      displayedTotalBytes === undefined
        ? rawVisibleDownloadedBytes
        : Math.min(rawVisibleDownloadedBytes, displayedTotalBytes);
    const visibleDownloadedBytes = Math.max(previous?.visibleDownloadedBytes ?? 0, cappedDownloaded);

    const calculatedPercent =
      displayedTotalBytes !== undefined && displayedTotalBytes > 0
        ? (visibleDownloadedBytes / displayedTotalBytes) * 100
        : undefined;
    const visiblePercent =
      calculatedPercent === undefined
        ? rawPercent === undefined
          ? previous?.visiblePercent
          : Math.max(previous?.visiblePercent ?? 0, rawPercent)
        : Math.min(99, Math.max(previous?.visiblePercent ?? 0, calculatedPercent));

    const view = {
      visiblePercent,
      visibleDownloadedBytes,
      displayedTotalBytes,
      downloadedIsEstimated,
      totalIsEstimated: job.payload.expectedSizeBytes !== undefined || progress.totalBytesEstimate !== undefined,
    };
    const state: ProgressState = {
      lastSentAt: previous?.lastSentAt,
      lastPercentInteger: previous?.lastPercentInteger,
      lastDownloadedLabel: previous?.lastDownloadedLabel,
      visiblePercent,
      visibleDownloadedBytes,
      downloadedIsEstimated,
      completedStageBytes,
      currentStageDownloadedBytes,
      previousDownloadedBytes: rawDownloadedBytes ?? previousDownloadedBytes,
      previousTotalBytes: currentStageTotalBytes ?? previous?.previousTotalBytes,
      previousPercent: rawPercent ?? previousPercent,
    };

    return { view, state };
  }

  private pruneTerminalJobs(): void {
    const now = this.now;
    let pruned = 0;
    for (const [jobId, expiresAt] of this.terminalJobs.entries()) {
      if (expiresAt <= now) {
        this.terminalJobs.delete(jobId);
        pruned += 1;
      }
    }

    const maxEntries = this.options.terminalMaxEntries ?? 500;
    while (this.terminalJobs.size > maxEntries) {
      const oldest = this.terminalJobs.keys().next().value as string | undefined;
      if (!oldest) break;
      this.terminalJobs.delete(oldest);
      pruned += 1;
    }

    if (pruned > 0) this.logger.debug("telegram.progress_dispatch.terminal_pruned", { pruned });
  }
}

function validBytes(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
