import type { PolicyReason, SerializableFormatOption } from "../../core/types.js";

export const TELEGRAM_DISPLAY_TOO_LARGE_BYTES = 2 * 1024 * 1024 * 1024;

export type TelegramDisplayPolicyReason = PolicyReason | "server_limit" | "allowed";

export type TelegramDisplayPolicyState = {
  reason: TelegramDisplayPolicyReason;
  disabled: boolean;
  expectedSizeBytes?: number;
};

export function evaluateTelegramDisplayPolicy(expectedSizeBytes: number | undefined): TelegramDisplayPolicyState {
  if (expectedSizeBytes === undefined) {
    return {
      reason: "unknown_size",
      disabled: false,
    };
  }

  if (expectedSizeBytes > TELEGRAM_DISPLAY_TOO_LARGE_BYTES) {
    return {
      reason: "too_large",
      disabled: true,
      expectedSizeBytes,
    };
  }

  return {
    reason: "allowed",
    disabled: false,
    expectedSizeBytes,
  };
}

export function telegramDisplayPolicyForOption(option: SerializableFormatOption): TelegramDisplayPolicyState {
  const displayPolicy = evaluateTelegramDisplayPolicy(option.estimatedSizeBytes);
  if (displayPolicy.reason === "too_large" || displayPolicy.reason === "unknown_size") return displayPolicy;

  if (option.disabled && option.disabledReason) {
    return {
      reason: option.disabledReason === "too_large" ? "server_limit" : option.disabledReason,
      disabled: true,
      expectedSizeBytes: option.estimatedSizeBytes,
    };
  }

  return displayPolicy;
}

