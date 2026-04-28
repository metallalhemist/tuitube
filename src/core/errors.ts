export type TuitubeErrorCode =
  | "MISSING_EXECUTABLE"
  | "INVALID_URL"
  | "LIVE_STREAM_UNSUPPORTED"
  | "DOWNLOAD_FAILED"
  | "PROCESS_FAILED"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "PROCESS_MAX_BUFFER"
  | "INVALID_CONFIG"
  | "QUEUE_FULL"
  | "JOB_CANCELLED"
  | "POLICY_REJECTED"
  | "UNSAFE_PATH"
  | "SUBTITLE_NOT_FOUND"
  | "UNKNOWN_ERROR";

export type TuitubeErrorSeverity = "warn" | "error";

export type TuitubeErrorOptions = {
  code: TuitubeErrorCode;
  message: string;
  severity?: TuitubeErrorSeverity;
  cause?: unknown;
  details?: Record<string, unknown>;
};

export class TuitubeError extends Error {
  readonly code: TuitubeErrorCode;
  readonly severity: TuitubeErrorSeverity;
  readonly details: Record<string, unknown>;

  constructor({ code, message, severity = "error", cause, details = {} }: TuitubeErrorOptions) {
    super(message, { cause });
    this.name = "TuitubeError";
    this.code = code;
    this.severity = severity;
    this.details = details;
  }
}

export function isTuitubeError(error: unknown): error is TuitubeError {
  return error instanceof TuitubeError;
}

export function missingExecutableError(executableName: string): TuitubeError {
  return new TuitubeError({
    code: "MISSING_EXECUTABLE",
    message: `${executableName} executable was not found`,
    details: { executableName },
  });
}

export function invalidUrlError(): TuitubeError {
  return new TuitubeError({
    code: "INVALID_URL",
    message: "URL is invalid",
    severity: "warn",
  });
}

export function liveStreamUnsupportedError(): TuitubeError {
  return new TuitubeError({
    code: "LIVE_STREAM_UNSUPPORTED",
    message: "Live streams are not supported",
    severity: "warn",
  });
}

export function downloadFailedError(
  message: string,
  details: Record<string, unknown> = {},
  cause?: unknown,
): TuitubeError {
  return new TuitubeError({
    code: "DOWNLOAD_FAILED",
    message,
    cause,
    details,
  });
}

export function normalizeError(error: unknown, fallbackMessage = "Unexpected error"): TuitubeError {
  if (isTuitubeError(error)) return error;

  if (error instanceof Error) {
    return new TuitubeError({
      code: "UNKNOWN_ERROR",
      message: error.message || fallbackMessage,
      cause: error,
    });
  }

  return new TuitubeError({
    code: "UNKNOWN_ERROR",
    message: fallbackMessage,
    details: { value: String(error) },
  });
}

export function boundedText(value: string | undefined, maxLength = 1200): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
