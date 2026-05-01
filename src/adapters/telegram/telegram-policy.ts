import type { PolicyReason, SerializableFormatOption } from "../../core/types.js";
import { createTelegramUploadPolicy, type TelegramUploadPolicy } from "./upload-limits.js";

export type TelegramDisplayPolicyReason = PolicyReason | "server_limit" | "telegram_upload_limit" | "allowed";

export type TelegramDisplayPolicyState = {
  reason: TelegramDisplayPolicyReason;
  disabled: boolean;
  expectedSizeBytes?: number;
};

export function evaluateTelegramDisplayPolicy(
  expectedSizeBytes: number | undefined,
  uploadPolicy: TelegramUploadPolicy = createTelegramUploadPolicy(undefined),
): TelegramDisplayPolicyState {
  if (expectedSizeBytes === undefined) {
    return {
      reason: "unknown_size",
      disabled: false,
    };
  }

  if (expectedSizeBytes > uploadPolicy.limitBytes) {
    return {
      reason: "telegram_upload_limit",
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

export function telegramDisplayPolicyForOption(
  option: SerializableFormatOption,
  uploadPolicy: TelegramUploadPolicy = createTelegramUploadPolicy(undefined),
): TelegramDisplayPolicyState {
  const displayPolicy = evaluateTelegramDisplayPolicy(option.estimatedSizeBytes, uploadPolicy);
  if (displayPolicy.reason === "telegram_upload_limit" || displayPolicy.reason === "unknown_size") return displayPolicy;

  if (option.disabled && option.disabledReason) {
    return {
      reason: option.disabledReason === "too_large" ? "server_limit" : option.disabledReason,
      disabled: true,
      expectedSizeBytes: option.estimatedSizeBytes,
    };
  }

  return displayPolicy;
}
