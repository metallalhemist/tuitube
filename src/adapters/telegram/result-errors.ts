export class TelegramResultAlreadyNotifiedError extends Error {
  readonly reason?: string;

  constructor(message: string, options: { reason?: string } = {}) {
    super(message);
    this.name = "TelegramResultAlreadyNotifiedError";
    this.reason = options.reason;
  }
}

export function isTelegramResultAlreadyNotifiedError(error: unknown): error is TelegramResultAlreadyNotifiedError {
  return error instanceof TelegramResultAlreadyNotifiedError;
}
