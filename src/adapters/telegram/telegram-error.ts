export function telegramErrorStatusCode(error: unknown): number | undefined {
  const record = error as {
    status?: unknown;
    statusCode?: unknown;
    error_code?: unknown;
    response?: { status?: unknown; statusCode?: unknown; error_code?: unknown };
  };
  const candidates = [
    record.status,
    record.statusCode,
    record.error_code,
    record.response?.status,
    record.response?.statusCode,
    record.response?.error_code,
  ];
  return candidates.find(
    (candidate): candidate is number => typeof candidate === "number" && Number.isFinite(candidate),
  );
}

export function telegramErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const record = error as { description?: unknown; message?: unknown; response?: { description?: unknown } };
  if (typeof record.description === "string") return record.description;
  if (typeof record.response?.description === "string") return record.response.description;
  if (typeof record.message === "string") return record.message;
  return String(error);
}

function telegramErrorCode(error: unknown): string | undefined {
  const record = error as {
    code?: unknown;
    errno?: unknown;
    response?: { code?: unknown; errno?: unknown };
  };
  const candidates = [record.code, record.errno, record.response?.code, record.response?.errno];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (normalized) return normalized.slice(0, 80);
  }
  return undefined;
}

export function telegramErrorReasonCode(error: unknown): string {
  const explicitCode = telegramErrorCode(error);
  if (explicitCode) return explicitCode;

  const statusCode = telegramErrorStatusCode(error);
  if (statusCode) return `http_${statusCode}`;

  const lowerText = telegramErrorText(error).toLowerCase();
  if (lowerText.includes("enoent")) return "enoent";
  if (lowerText.includes("eacces")) return "eacces";
  if (lowerText.includes("request entity too large")) return "request_entity_too_large";
  if (lowerText.includes("file is too big") || lowerText.includes("file too big")) return "file_too_big";
  if (error instanceof Error) return "error";
  return typeof error;
}

export function sanitizeTelegramError(error: unknown): string {
  return redactSensitiveTelegramErrorText(telegramErrorText(error)).slice(0, 300);
}

export function redactSensitiveTelegramErrorText(text: string): string {
  const pathExtension = String.raw`(?:mp4|mkv|mov|webm|flv|m4a|aac|mp3|opus|ogg|wav|flac|weba|txt|srt|vtt)`;
  const unquotedPathText = "[^\\r\\n\"'`<>]*?";
  return text
    .replace(new RegExp(String.raw`file://${unquotedPathText}\.${pathExtension}\b`, "gi"), "file://[path]")
    .replace(/file:\/\/\S+/gi, "file://[path]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/(["'`])(?:[A-Za-z]:[\\/]|\/)[^"'`\r\n]*\1/g, "$1[path]$1")
    .replace(new RegExp(String.raw`\b[A-Za-z]:[\\/]${unquotedPathText}\.${pathExtension}\b`, "gi"), "[path]")
    .replace(new RegExp(String.raw`(^|[\s(=:,])/${unquotedPathText}\.${pathExtension}\b`, "gi"), "$1[path]")
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, "[path]")
    .replace(/(^|[\s(=:,])\/(?:[^/\s"'`<>]+\/)+[^/\s"'`<>]*/g, "$1[path]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}
