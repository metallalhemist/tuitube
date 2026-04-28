export type SanitizationPlatform = NodeJS.Platform | "posix";

export function sanitizeVideoTitle(name: string, platform: SanitizationPlatform = process.platform): string {
  const maxLen = 200;
  const invalidChars = platform === "win32" ? ["<", ">", ":", '"', "/", "\\", "|", "?", "*"] : [":"];

  let safe = name.trim();
  for (const char of invalidChars) {
    safe = safe.replaceAll(char, "");
  }

  safe = Array.from(safe)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("");

  if (platform === "win32") safe = safe.replace(/[. ]+$/, "");

  safe = safe.replace(/\s+/g, " ");
  safe = safe.slice(0, maxLen);

  const cutoffSymbols = /[.!?]/g;
  const match = [...safe.matchAll(cutoffSymbols)]
    .map((m) => m.index)
    .filter((idx) => idx !== undefined && idx <= maxLen);

  if (match.length > 0) {
    safe = safe.slice(0, match[match.length - 1]);
  }

  return safe.trim() || "untitled";
}
