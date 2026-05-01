export class TelegramResultAlreadyNotifiedError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "TelegramResultAlreadyNotifiedError";
    this.cause = options.cause;
  }
}

export function isTelegramResultAlreadyNotifiedError(error: unknown): error is TelegramResultAlreadyNotifiedError {
  return error instanceof TelegramResultAlreadyNotifiedError;
}
