import type { TranscriptResult } from "../services/transcript-service.js";
import type { DownloadResult, VideoSelectionSnapshot } from "../types.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type MediaJobAction =
  | "prepare_metadata"
  | "download_best"
  | "download_format"
  // Compatibility-only for jobs created by older Telegram menu flows.
  | "extract_mp3"
  // Compatibility-only for jobs created by older Telegram menu flows.
  | "extract_transcript";

export type MediaJobPayload = {
  url: string;
  formatValue?: string;
  language?: string;
  menuMessageId?: number;
};

export type MediaJobResult =
  | { type: "metadata"; snapshot: VideoSelectionSnapshot }
  | { type: "download"; download: Pick<DownloadResult, "filePath" | "fileName" | "title" | "duration"> }
  | { type: "transcript"; transcript: TranscriptResult };

export type MediaJob = {
  id: string;
  action: MediaJobAction;
  payload: MediaJobPayload;
  chatId?: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  result?: MediaJobResult;
};

export type DownloadJob = MediaJob;

export interface JobQueue<TJob extends { id: string }> {
  enqueue(job: TJob): Promise<void>;
  next(signal?: AbortSignal): Promise<TJob | undefined>;
  cancel(jobId: string): boolean;
  size(): number;
  close(): void;
}
