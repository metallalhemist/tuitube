import { createConsoleLogger } from "../core/logger.js";
import { InMemoryJobQueue } from "../core/jobs/in-memory-queue.js";
import { JobService } from "../core/jobs/job-service.js";
import { DownloadWorker } from "../core/jobs/download-worker.js";
import type { DownloadJob } from "../core/jobs/queue.js";
import { VideoDownloadService } from "../core/services/video-download-service.js";
import { resolveExecutables } from "../integrations/executables.js";
import { createTelegramBot } from "../adapters/telegram/bot.js";
import { buildWebhookUrl, loadServerConfig, redactWebhookUrl } from "./config.js";
import { createServerApp } from "./app.js";
import { installSignalHandlers } from "./lifecycle.js";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const logger = createConsoleLogger(config.logLevel);
  logger.info("server.startup.config", {
    host: config.host,
    port: config.port,
    webhookPath: config.telegram.webhookPath,
    localApiRootEnabled: Boolean(config.telegram.apiRoot),
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

  const queue = new InMemoryJobQueue<DownloadJob>({ maxSize: config.maxQueueSize, logger });
  const jobService = new JobService(queue, logger);
  const worker = new DownloadWorker({
    queue,
    jobService,
    downloadService,
    maxConcurrency: config.maxConcurrentDownloads,
    logger,
  });
  worker.start();

  const bot = createTelegramBot({
    botToken: config.telegram.botToken,
    apiRoot: config.telegram.apiRoot,
    jobService,
    logger,
  });

  const server = createServerApp({ config, bot, jobService, worker, logger });
  installSignalHandlers({ server, logger });

  if (config.telegram.webhookUrl) {
    const finalWebhookUrl = buildWebhookUrl(config.telegram.webhookUrl, config.telegram.webhookPath);
    await bot.api.setWebhook(finalWebhookUrl, {
      secret_token: config.telegram.webhookSecret,
      allowed_updates: ["message"],
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
