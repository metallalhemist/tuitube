import type { InlineKeyboardButton } from "grammy/types";
import type { DownloadProgress } from "../core/download-progress.js";
import type { MediaJob } from "../core/jobs/queue.js";
import { noopLogger, type Logger } from "../core/logger.js";
import type { TelegramMenuSessionStore } from "../adapters/telegram/menu-session-store.js";
import type { DownloadMenus } from "../adapters/telegram/menus/download-menu.js";
import {
  TelegramDownloadProgressDispatcher,
  type TelegramProgressApi,
} from "../adapters/telegram/download-progress-dispatcher.js";
import { TelegramProgressCleanup, type TelegramProgressCleanupApi } from "../adapters/telegram/progress-cleanup.js";

export type TelegramRuntimeApi = TelegramProgressApi &
  TelegramProgressCleanupApi & {
    editMessageReplyMarkup?(
      chatId: string,
      messageId: number,
      options?: { reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } },
    ): Promise<unknown>;
  };

export function createTelegramProgressRuntime({
  api,
  store,
  menus,
  logger = noopLogger,
}: {
  api: TelegramRuntimeApi;
  store: TelegramMenuSessionStore;
  menus: Pick<DownloadMenus, "renderRootMenuMarkup">;
  logger?: Logger;
}): {
  dispatcher: TelegramDownloadProgressDispatcher;
  cleanup: TelegramProgressCleanup;
  onJobProgress(job: MediaJob, progress: DownloadProgress): Promise<void>;
} {
  const dispatcher = new TelegramDownloadProgressDispatcher({
    api,
    logger,
    renderReplyMarkup: async (job) => {
      if (!job.chatId || !job.payload.menuMessageId) return undefined;
      return menus.renderRootMenuMarkup(job.chatId, job.payload.menuMessageId);
    },
  });
  const cleanup = new TelegramProgressCleanup({ api, store, dispatcher, logger });
  logger.info("telegram.runtime.progress_enabled");

  return {
    dispatcher,
    cleanup,
    onJobProgress: async (job, progress) => dispatcher.dispatch(job, progress),
  };
}
