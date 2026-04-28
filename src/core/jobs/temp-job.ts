import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TuitubeError } from "../errors.js";
import { noopLogger, type Logger } from "../logger.js";

export type TempJobDirectory = {
  jobId: string;
  baseDirectory: string;
  path: string;
  cleanup: () => Promise<void>;
};

export type CreateTempJobDirectoryOptions = {
  baseDirectory: string;
  jobId?: string;
  logger?: Logger;
};

function assertInsideBase(baseDirectory: string, candidatePath: string): void {
  const relative = path.relative(baseDirectory, candidatePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;

  throw new TuitubeError({
    code: "UNSAFE_PATH",
    message: "Temporary job path escapes base directory",
    severity: "warn",
    details: { baseDirectory, candidatePath },
  });
}

export async function resolveSafeBaseDirectory(baseDirectory: string): Promise<string> {
  if (!baseDirectory.trim()) {
    throw new TuitubeError({
      code: "UNSAFE_PATH",
      message: "Base directory is empty",
      severity: "warn",
    });
  }

  const resolvedBase = path.resolve(baseDirectory);
  await mkdir(resolvedBase, { recursive: true });
  const realBase = await realpath(resolvedBase);
  assertInsideBase(path.dirname(realBase), realBase);
  return realBase;
}

export async function createTempJobDirectory({
  baseDirectory,
  jobId = randomUUID(),
  logger = noopLogger,
}: CreateTempJobDirectoryOptions): Promise<TempJobDirectory> {
  logger.debug("temp_job.create.start", { jobId });
  const safeBase = await resolveSafeBaseDirectory(baseDirectory);
  const jobDirectory = await mkdtemp(path.join(safeBase, `tuitube-${jobId}-`));
  const realJobDirectory = await realpath(jobDirectory);
  assertInsideBase(safeBase, realJobDirectory);
  logger.debug("temp_job.create.finish", { jobId, path: realJobDirectory });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) {
      logger.debug("temp_job.cleanup.skip", { jobId, path: realJobDirectory });
      return;
    }

    logger.debug("temp_job.cleanup.start", { jobId, path: realJobDirectory });
    try {
      await rm(realJobDirectory, { recursive: true, force: true });
      cleaned = true;
      logger.debug("temp_job.cleanup.finish", { jobId, path: realJobDirectory });
    } catch (error) {
      logger.warn("temp_job.cleanup.failed", {
        jobId,
        path: realJobDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    jobId,
    baseDirectory: safeBase,
    path: realJobDirectory,
    cleanup,
  };
}
