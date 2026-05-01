import { createConsoleLogger } from "../core/logger.js";
import { InMemoryJobQueue } from "../core/jobs/in-memory-queue.js";
import { JobService } from "../core/jobs/job-service.js";
import { DownloadWorker } from "../core/jobs/download-worker.js";
import type { MediaJob } from "../core/jobs/queue.js";
import { VideoDownloadService } from "../core/services/video-download-service.js";
import { TranscriptService } from "../core/services/transcript-service.js";
import { resolveExecutables } from "../integrations/executables.js";
import { createTelegramBot } from "../adapters/telegram/bot.js";
import { telegramCopy } from "../adapters/telegram/copy.js";
import { createDownloadMenus } from "../adapters/telegram/menus/download-menu.js";
import { TelegramMenuSessionStore } from "../adapters/telegram/menu-session-store.js";
import { TelegramMetadataResultDispatcher } from "../adapters/telegram/metadata-result-dispatcher.js";
import { isTelegramResultAlreadyNotifiedError } from "../adapters/telegram/result-errors.js";
import { TelegramResultSender } from "../adapters/telegram/result-sender.js";
import { buildWebhookUrl, loadServerConfig, redactWebhookUrl } from "./config.js";
import { createServerApp } from "./app.js";
import { installSignalHandlers } from "./lifecycle.js";
import { registerTelegramWebhook } from "./webhook-registration.js";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const logger = createConsoleLogger(config.logLevel);
  logger.info("server.startup.config", {
    host: config.host,
    port: config.port,
    updateMode: config.telegram.updateMode,
    webhookPath: config.telegram.webhookPath,
    telegramUploadMode: config.telegram.uploadPolicy.mode,
    localApiRootEnabled: config.telegram.uploadPolicy.isLocalBotApiMode,
    telegramUploadLimitBytes: config.telegram.uploadPolicy.limitBytes,
  });

  const executables = await resolveExecutables({
    ...config.executables,
    pathEnv: config.pathEnv,
    logger,
  });

  const downloadService = new VideoDownloadService({
    ytdlpPath: executables["yt-dlp"].path,
    ffmpegPath: executables.ffmpeg.path,
    downloadDirectory: config.downloadDirectory,
    forceIpv4: config.forceIpv4,
    timeoutMs: config.commandTimeoutMs,
    maxBufferBytes: config.processMaxBufferBytes,
    policy: config.policy,
    logger,
    env: { PATH: config.pathEnv, PYTHONUNBUFFERED: "1" },
  });

  const transcriptService = new TranscriptService({
    ytdlpPath: executables["yt-dlp"].path,
    ffmpegPath: executables.ffmpeg.path,
    downloadDirectory: config.downloadDirectory,
    forceIpv4: config.forceIpv4,
    timeoutMs: config.commandTimeoutMs,
    maxBufferBytes: config.processMaxBufferBytes,
    logger,
    env: { PATH: config.pathEnv, PYTHONUNBUFFERED: "1" },
  });

  const queue = new InMemoryJobQueue<MediaJob>({ maxSize: config.maxQueueSize, logger });
  const jobService = new JobService(queue, logger);
  const menuSessionStore = new TelegramMenuSessionStore({ logger });
  const workerRef: { current?: DownloadWorker } = {};

  const menus = createDownloadMenus({
    store: menuSessionStore,
    logger,
    onFormatSelected: async ({ ctx, session, formatValue }) => {
      await ctx.reply(telegramCopy.downloadStarted);
      const job = await jobService.createMediaJob({
        action: "download_format",
        payload: { url: session.url, formatValue },
        chatId: session.chatId,
      });
      await ctx.reply(telegramCopy.queueAccepted(job.id)).catch((error: unknown) => {
        logger.warn("telegram.menu.format.queue_accept_reply_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return { jobId: job.id };
    },
    onCancel: async ({ ctx, session }) => {
      if (session.activeJobId) {
        const worker = workerRef.current;
        if (worker) worker.cancel(session.activeJobId);
        else jobService.cancelJob(session.activeJobId);
      }
      await ctx.reply(telegramCopy.cancelled);
    },
  });

  const bot = createTelegramBot({
    botToken: config.telegram.botToken,
    apiRoot: config.telegram.apiRoot,
    jobService,
    menus,
    logger,
  });

  const metadataDispatcher = new TelegramMetadataResultDispatcher({
    api: bot.api,
    store: menuSessionStore,
    menus,
    logger,
  });
  const resultSender = new TelegramResultSender({ api: bot.api, uploadPolicy: config.telegram.uploadPolicy, logger });
  const worker = new DownloadWorker({
    queue,
    jobService,
    downloadService,
    transcriptService,
    maxConcurrency: config.maxConcurrentDownloads,
    logger,
    onMetadataPrepared: async (job, snapshot) => metadataDispatcher.dispatchPrepared(job, snapshot),
    onJobCompleted: async (job, result) => resultSender.sendDownload(job, result),
    onTranscriptCompleted: async (job, result) => resultSender.sendTranscript(job, result),
    onJobFailed: async (job, error) => {
      if (job.action === "prepare_metadata") {
        await metadataDispatcher.dispatchFailed(job);
        return;
      }

      if (isTelegramResultAlreadyNotifiedError(error)) {
        logger.debug("telegram.result_sender.failure_suppressed_already_notified", {
          jobId: job.id,
          action: job.action,
        });
        return;
      }

      await resultSender.sendFailure(job);
    },
  });
  workerRef.current = worker;
  worker.start();

  const server = createServerApp({ config, bot, jobService, worker, logger });
  installSignalHandlers({ server, logger });

  if (config.telegram.updateMode === "polling") {
    logger.info("telegram.polling.start");
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: (botInfo) => {
        logger.info("telegram.polling.started", { username: botInfo.username });
      },
    });
  } else if (config.telegram.webhookUrl) {
    const finalWebhookUrl = buildWebhookUrl(config.telegram.webhookUrl, config.telegram.webhookPath);
    await registerTelegramWebhook({
      bot,
      webhookUrl: finalWebhookUrl,
      webhookSecret: config.telegram.webhookSecret,
      logger,
    });
    logger.info("telegram.webhook.registered", { webhookUrl: redactWebhookUrl(finalWebhookUrl) });
  } else {
    logger.info("telegram.webhook.registration_skipped");
  }

  await server.listen({ host: config.host, port: config.port });
  logger.info("server.startup.listen", { host: config.host, port: config.port });
}

main().catch((error) => {
  const logger = createConsoleLogger("error");
  logger.error("server.startup.failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
