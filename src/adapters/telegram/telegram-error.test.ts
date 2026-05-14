import { describe, expect, it } from "vitest";
import { sanitizeTelegramError, telegramErrorReasonCode, telegramErrorStatusCode } from "./telegram-error.js";

describe("telegram error helpers", () => {
  it("extracts status and reason codes", () => {
    expect(telegramErrorStatusCode({ error_code: 413 })).toBe(413);
    expect(telegramErrorReasonCode({ error_code: 413 })).toBe("http_413");
    expect(telegramErrorReasonCode(new Error("Request Entity Too Large"))).toBe("request_entity_too_large");
  });

  it("redacts paths, URLs, bot tokens, and token-like strings", () => {
    const text =
      "failed '/tmp/private title.mp4' file:///tmp/private title.mp4 https://api.telegram.org/bot123:SECRET/sendVideo abcdef0123456789abcdef0123456789";

    const sanitized = sanitizeTelegramError(new Error(text));

    expect(sanitized).toContain("[path]");
    expect(sanitized).toContain("[url]");
    expect(sanitized).toContain("[redacted]");
    expect(sanitized).not.toContain("/tmp/private");
    expect(sanitized).not.toContain("SECRET");
    expect(sanitized).not.toContain("abcdef0123456789abcdef0123456789");
  });
});
