import type { DownloadResult } from "../types.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type DownloadJob = {
  id: string;
  url: string;
  formatValue?: string;
  chatId?: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  result?: Pick<DownloadResult, "filePath" | "fileName" | "title" | "duration">;
};

export interface JobQueue<TJob extends { id: string }> {
  enqueue(job: TJob): Promise<void>;
  next(signal?: AbortSignal): Promise<TJob | undefined>;
  size(): number;
  close(): void;
}
