import { mkdir, statfs } from "node:fs/promises";
import path from "node:path";
import { noopLogger, type Logger } from "../core/logger.js";

export type DiskSpace = {
  directory: string;
  freeBytes: number;
};

export async function ensureDirectory(directory: string, logger: Logger = noopLogger): Promise<string> {
  const resolved = path.resolve(directory);
  logger.debug("filesystem.ensure_directory.start", { directory: resolved });
  await mkdir(resolved, { recursive: true });
  logger.debug("filesystem.ensure_directory.finish", { directory: resolved });
  return resolved;
}

export async function getFreeDiskSpaceBytes(directory: string, logger: Logger = noopLogger): Promise<DiskSpace> {
  const resolved = await ensureDirectory(directory, logger);
  logger.debug("filesystem.free_disk.start", { directory: resolved });
  const stats = await statfs(resolved);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  logger.debug("filesystem.free_disk.finish", { directory: resolved, freeBytes });
  return { directory: resolved, freeBytes };
}
