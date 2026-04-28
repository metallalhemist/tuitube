import Fastify, { type FastifyInstance } from "fastify";
import { webhookCallback, type Bot } from "grammy";
import { noopLogger, type Logger } from "../core/logger.js";
import type { JobService } from "../core/jobs/job-service.js";
import type { DownloadWorker } from "../core/jobs/download-worker.js";
import type { ServerConfig } from "./config.js";

export type CreateServerAppOptions = {
  config: ServerConfig;
  bot: Bot;
  jobService: JobService;
  worker?: DownloadWorker;
  logger?: Logger;
};

export function createServerApp({
  config,
  bot,
  jobService,
  worker,
  logger = noopLogger,
}: CreateServerAppOptions): FastifyInstance {
  const server = Fastify({
    logger: false,
    requestTimeout: config.requestTimeoutMs,
    bodyLimit: config.bodyLimitBytes,
  });

  server.get("/healthz", async () => {
    logger.debug("server.healthz");
    return {
      ok: true,
      status: "ok",
      queueSize: jobService.listJobs().filter((job) => job.status === "queued").length,
    };
  });

  const webhookSecret = config.telegram.webhookSecret;
  if (!webhookSecret) {
    server.post(config.telegram.webhookPath, async (_request, reply) => {
      logger.warn("server.webhook.rejected", { reason: "missing_configured_secret" });
      return reply.code(401).send({ error: "Telegram webhook secret is required" });
    });
  } else {
    server.post(
      config.telegram.webhookPath,
      {
        preHandler: async (request, reply) => {
          const receivedSecret = request.headers["x-telegram-bot-api-secret-token"];
          if (Array.isArray(receivedSecret) || receivedSecret !== webhookSecret) {
            logger.warn("server.webhook.rejected", { reason: "invalid_secret_header" });
            return reply.code(401).send({ error: "Unauthorized" });
          }
        },
      },
      webhookCallback(bot, "fastify", {
        secretToken: webhookSecret,
        timeoutMilliseconds: config.webhookTimeoutMs,
        onTimeout: "return",
      }),
    );
  }

  server.addHook("onClose", async () => {
    logger.info("server.on_close.start");
    await worker?.stop({ timeoutMs: config.shutdownTimeoutMs, cancelRunning: true });
    logger.info("server.on_close.finish");
  });

  return server;
}
