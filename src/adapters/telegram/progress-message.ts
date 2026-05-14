import { formatTelegramProgressBytes, telegramCopy } from "./copy.js";

export type TelegramProgressView = {
  visiblePercent?: number;
  visibleDownloadedBytes: number;
  displayedTotalBytes?: number;
  downloadedIsEstimated?: boolean;
  totalIsEstimated?: boolean;
};

export function createInitialTelegramProgressView(expectedSizeBytes?: number): TelegramProgressView {
  return {
    visiblePercent: 0,
    visibleDownloadedBytes: 0,
    displayedTotalBytes: expectedSizeBytes,
    totalIsEstimated: typeof expectedSizeBytes === "number",
  };
}

export function renderTelegramDownloadProgressText(view: TelegramProgressView): string {
  const downloadedPrefix = view.downloadedIsEstimated ? "~" : "";
  const totalPrefix = view.totalIsEstimated ? "~" : "";
  const downloaded = `${downloadedPrefix}${formatTelegramProgressBytes(view.visibleDownloadedBytes)}`;
  const total =
    typeof view.displayedTotalBytes === "number"
      ? `${totalPrefix}${formatTelegramProgressBytes(view.displayedTotalBytes)}`
      : telegramCopy.progressUnknownTotal;

  return `${telegramCopy.downloadProgress(downloaded, total)}\n${renderProgressBar(view.visiblePercent)}`;
}

export function renderTelegramTerminalProgressText(state: "completed" | "failed" | "cancelled", text?: string): string {
  if (text) return text;
  if (state === "completed") return telegramCopy.completed;
  if (state === "cancelled") return telegramCopy.cancelled;
  return telegramCopy.failed;
}

function renderProgressBar(percent: number | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "[----------]";
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.floor(clamped / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${Math.floor(clamped)}%`;
}
