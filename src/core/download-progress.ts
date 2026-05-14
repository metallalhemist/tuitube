export type DownloadProgressSource = "stdout" | "stderr";

export type DownloadProgress = {
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  totalBytesEstimate?: number;
  status?: string;
  source?: DownloadProgressSource;
  rawLine?: string;
};

export const YTDLP_PROGRESS_PREFIX = "TUITUBE_PROGRESS";

export const YTDLP_PROGRESS_TEMPLATE = `download:${YTDLP_PROGRESS_PREFIX}\t%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress._percent_str)s`;

const missingProgressValues = new Set(["", "na", "n/a", "none", "null", "unknown"]);

function parseProgressNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (missingProgressValues.has(normalized)) return undefined;
  const parsed = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseProgressBytes(value: string | undefined): number | undefined {
  const parsed = parseProgressNumber(value);
  if (parsed === undefined) return undefined;
  return Math.floor(parsed);
}

function parsePercent(value: string | undefined): number | undefined {
  const parsed = parseProgressNumber(value?.replace("%", ""));
  if (parsed === undefined) return undefined;
  return Math.min(100, Math.max(0, parsed));
}

function parseHumanBytes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "b"
      ? 1
      : unit === "kb" || unit === "kib"
        ? 1024
        : unit === "mb" || unit === "mib"
          ? 1024 ** 2
          : unit === "gb" || unit === "gib"
            ? 1024 ** 3
            : unit === "tb" || unit === "tib"
              ? 1024 ** 4
              : unit === "pb" || unit === "pib"
                ? 1024 ** 5
                : undefined;
  return multiplier ? Math.floor(amount * multiplier) : undefined;
}

export function parseYtDlpDownloadProgress(line: string): DownloadProgress | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith(YTDLP_PROGRESS_PREFIX)) {
    const [, status, downloadedBytes, totalBytes, totalBytesEstimate, percent] = trimmed.split("\t");
    const parsed: DownloadProgress = {
      rawLine: line,
      status: missingProgressValues.has((status ?? "").trim().toLowerCase()) ? undefined : status?.trim(),
      downloadedBytes: parseProgressBytes(downloadedBytes),
      totalBytes: parseProgressBytes(totalBytes),
      totalBytesEstimate: parseProgressBytes(totalBytesEstimate),
      percent: parsePercent(percent),
    };

    if (
      parsed.status ||
      parsed.downloadedBytes !== undefined ||
      parsed.totalBytes !== undefined ||
      parsed.totalBytesEstimate !== undefined ||
      parsed.percent !== undefined
    ) {
      return parsed;
    }
    return undefined;
  }

  const fallback = trimmed.match(
    /^\[download]\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+([0-9.]+\s*[kmgtp]?i?b|[0-9.]+\s*[kmgtp]?b)/i,
  );
  if (!fallback) return undefined;

  return {
    rawLine: line,
    percent: parsePercent(fallback[1]),
    totalBytes: parseHumanBytes(fallback[2]),
  };
}
