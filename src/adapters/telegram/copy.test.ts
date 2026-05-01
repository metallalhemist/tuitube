import { describe, expect, it } from "vitest";
import type { SerializableFormatOption } from "../../core/types.js";
import {
  audioFormatButtonLabel,
  formatOptionButtonLabel,
  formatTelegramBytes,
  jobFailedText,
  telegramCopy,
  transcriptDeliveryMode,
} from "./copy.js";
import { evaluateTelegramDisplayPolicy, telegramDisplayPolicyForOption } from "./telegram-policy.js";
import {
  createTelegramUploadPolicy,
  TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
} from "./upload-limits.js";

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
    expect(telegramCopy.start).not.toContain("расшифров");
    expect(telegramCopy.mainMenuTitle("Title", 30)).not.toContain("расшифров");
    expect(telegramCopy.invalidUrl).toContain("Не похоже");
    expect(telegramCopy.queueAccepted("job-1")).toContain("Задача принята");
    expect(jobFailedText("SUBTITLE_NOT_FOUND")).toContain("не найдены");
  });

  it("uses cloud or Local Bot API upload limits for menu display policy", () => {
    expect(evaluateTelegramDisplayPolicy(TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES).reason).toBe("allowed");
    expect(evaluateTelegramDisplayPolicy(TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1).reason).toBe("telegram_upload_limit");
    expect(
      evaluateTelegramDisplayPolicy(
        TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1,
        createTelegramUploadPolicy("http://127.0.0.1:18081"),
      ).reason,
    ).toBe("allowed");
    expect(
      evaluateTelegramDisplayPolicy(
        TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES + 1,
        createTelegramUploadPolicy("http://127.0.0.1:18081"),
      ).reason,
    ).toBe("telegram_upload_limit");
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
    expect(formatOptionButtonLabel(option({ estimatedSizeBytes: 0 }))).toBe("360p");
    expect(formatOptionButtonLabel(option({ estimatedSizeBytes: undefined }))).toBe("360p");
    expect(formatOptionButtonLabel(option({ disabled: true, disabledReason: "unknown_size" }))).toBe("360p · 100 Б");
  });

  it("renders known video sizes and audio format labels compactly", () => {
    expect(
      formatOptionButtonLabel(option({ height: 720, resolution: "720p", estimatedSizeBytes: 42.3 * 1024 ** 2 })),
    ).toBe("720p · 42.3 МиБ");
    expect(audioFormatButtonLabel(option({ value: "140#m4a", extension: "m4a", container: "m4a" }))).toBe("M4A");
    expect(audioFormatButtonLabel(option({ value: "251#opus", extension: "opus", container: "opus" }))).toBe("OPUS");
    expect(audioFormatButtonLabel(option({ value: "251#webm", extension: "webm", container: "webm" }))).toBe(
      "WEBM Audio",
    );
  });

  it("chooses transcript document fallback for long transcripts", () => {
    expect(transcriptDeliveryMode("короткий текст")).toBe("message");
    expect(transcriptDeliveryMode("а".repeat(4_000))).toBe("document");
  });
});
