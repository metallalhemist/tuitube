import { describe, expect, it } from "vitest";
import type { SerializableFormatOption } from "../../core/types.js";
import { formatOptionButtonLabel, formatTelegramBytes, jobFailedText, telegramCopy, transcriptDeliveryMode } from "./copy.js";
import {
  evaluateTelegramDisplayPolicy,
  TELEGRAM_DISPLAY_TOO_LARGE_BYTES,
  telegramDisplayPolicyForOption,
} from "./telegram-policy.js";

function option(overrides: Partial<SerializableFormatOption> = {}): SerializableFormatOption {
  return {
    id: "18#mp4",
    value: "18#mp4",
    title: "360p | mp4",
    resolution: "360p",
    extension: "mp4",
    formatId: "18",
    estimatedSizeBytes: 100,
    disabled: false,
    policy: { disabled: false, expectedSizeBytes: 100 },
    ...overrides,
  };
}

describe("telegram copy and display policy", () => {
  it("uses Russian copy for common messages", () => {
    expect(telegramCopy.start).toContain("Пришлите ссылку");
    expect(telegramCopy.invalidUrl).toContain("Не похоже");
    expect(telegramCopy.queueAccepted("job-1")).toContain("Задача принята");
    expect(jobFailedText("SUBTITLE_NOT_FOUND")).toContain("не найдены");
  });

  it("shows too_large only above the 2 GiB Telegram display threshold", () => {
    expect(evaluateTelegramDisplayPolicy(TELEGRAM_DISPLAY_TOO_LARGE_BYTES).reason).toBe("allowed");
    expect(evaluateTelegramDisplayPolicy(TELEGRAM_DISPLAY_TOO_LARGE_BYTES + 1).reason).toBe("too_large");
    expect(evaluateTelegramDisplayPolicy(undefined).reason).toBe("unknown_size");
  });

  it("maps smaller core size rejections to server limit text", () => {
    const displayPolicy = telegramDisplayPolicyForOption(
      option({
        estimatedSizeBytes: 100,
        disabled: true,
        disabledReason: "too_large",
        policy: { disabled: true, reason: "too_large", expectedSizeBytes: 100 },
      }),
    );

    expect(displayPolicy.reason).toBe("server_limit");
    expect(formatOptionButtonLabel(option({ disabled: true, disabledReason: "too_large" }), displayPolicy)).toContain(
      "ограничение сервера",
    );
  });

  it("treats zero and invalid byte sizes as unknown", () => {
    expect(formatTelegramBytes(0)).toBe("неизвестный размер");
    expect(formatTelegramBytes(-1)).toBe("неизвестный размер");
    expect(formatTelegramBytes(Number.NaN)).toBe("неизвестный размер");
    expect(formatOptionButtonLabel(option({ estimatedSizeBytes: 0 }))).toBe("360p · неизвестный размер");
    expect(formatOptionButtonLabel(option({ disabled: true, disabledReason: "unknown_size" }))).toBe(
      "360p · 100 Б",
    );
  });

  it("chooses transcript document fallback for long transcripts", () => {
    expect(transcriptDeliveryMode("короткий текст")).toBe("message");
    expect(transcriptDeliveryMode("а".repeat(4_000))).toBe("document");
  });
});
