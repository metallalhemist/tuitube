import type { FastifyInstance } from "fastify";
import { noopLogger, type Logger } from "../core/logger.js";

export type InstallSignalHandlersOptions = {
  server: FastifyInstance;
  logger?: Logger;
};

export function installSignalHandlers({ server, logger = noopLogger }: InstallSignalHandlersOptions): () => void {
  let closing = false;

  const close = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info("server.shutdown.signal", { signal });
    try {
      logger.info("server.shutdown.start");
      await server.close();
      logger.info("server.shutdown.finish");
      process.exitCode = 0;
    } catch (error) {
      logger.error("server.shutdown.failed", { error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    }
  };

  const onSigint = () => void close("SIGINT");
  const onSigterm = () => void close("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}
