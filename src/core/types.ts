export type Format = {
  format_id: string;
  vcodec: string;
  acodec: string;
  ext: string;
  video_ext: string;
  protocol: string;
  filesize?: number;
  filesize_approx?: number;
  resolution: string;
  tbr: number | null;
  width?: number;
  height?: number;
  format_note?: string;
};

export type Video = {
  id?: string;
  title: string;
  duration: number;
  live_status?: string;
  formats: Format[];
};

export type DownloadOptions = {
  url: string;
  format: string;
  copyToClipboard: boolean;
  startTime?: string;
  endTime?: string;
};

export type ExecutableName = "yt-dlp" | "ffmpeg" | "ffprobe";

export type ExecutablePaths = {
  ytdlpPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type CommandRuntimeOptions = {
  timeoutMs: number;
  maxBufferBytes: number;
  forceIpv4: boolean;
};

export type ProcessFailure = {
  code: string;
  executablePath: string;
  exitCode?: number;
  signal?: string;
  timedOut: boolean;
  isCanceled: boolean;
  isMaxBuffer: boolean;
  stdoutExcerpt: string;
  stderrExcerpt: string;
};

export type PolicyReason = "too_large" | "insufficient_disk" | "unknown_size" | "queue_full";

export type PolicyState = {
  disabled: boolean;
  reason?: PolicyReason;
  expectedSizeBytes?: number;
  maxSizeBytes?: number;
  freeDiskBytes?: number;
  minFreeDiskBytes?: number;
};

export type SerializableFormatOption = {
  id: string;
  value: string;
  title: string;
  resolution: string;
  extension: string;
  formatId: string;
  estimatedSizeBytes?: number;
  disabled: boolean;
  disabledReason?: PolicyReason;
  policy: PolicyState;
};

export type DownloadResult = {
  filePath: string;
  fileName: string;
  title: string;
  duration: number;
  jobId: string;
  cleanup: () => Promise<void>;
};
