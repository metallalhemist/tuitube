export const TELEGRAM_OFFICIAL_API_ROOT = "https://api.telegram.org";
export const TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES = 2_000 * 1024 * 1024;

export type TelegramUploadMode = "cloud" | "local";

export type TelegramUploadPolicy = {
  mode: TelegramUploadMode;
  isLocalBotApiMode: boolean;
  limitBytes: number;
  limitLabel: string;
};

export class TelegramApiRootConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramApiRootConfigError";
  }
}

function apiRootHasBotTokenPath(pathname: string): boolean {
  return /(?:^|\/)bot[^/]+\/?$/i.test(pathname);
}

export function normalizeTelegramApiRoot(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TelegramApiRootConfigError("TELEGRAM_API_ROOT must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TelegramApiRootConfigError("TELEGRAM_API_ROOT must use http:// or https://");
  }

  if (url.username || url.password) {
    throw new TelegramApiRootConfigError("TELEGRAM_API_ROOT must not contain credentials");
  }

  if (url.search || url.hash) {
    throw new TelegramApiRootConfigError("TELEGRAM_API_ROOT must be a root URL without query or hash");
  }

  if (apiRootHasBotTokenPath(url.pathname)) {
    throw new TelegramApiRootConfigError("TELEGRAM_API_ROOT must not include a /bot<TOKEN> suffix");
  }

  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function isOfficialCloudApiRoot(apiRoot: string | undefined): boolean {
  const normalized = normalizeTelegramApiRoot(apiRoot);
  return normalized === TELEGRAM_OFFICIAL_API_ROOT;
}

export function isLocalBotApiMode(apiRoot: string | undefined): boolean {
  const normalized = normalizeTelegramApiRoot(apiRoot);
  return Boolean(normalized && normalized !== TELEGRAM_OFFICIAL_API_ROOT);
}

export function telegramUploadLimitBytes(apiRoot: string | undefined): number {
  return isLocalBotApiMode(apiRoot) ? TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES : TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES;
}

export function createTelegramUploadPolicy(apiRoot: string | undefined): TelegramUploadPolicy {
  const localMode = isLocalBotApiMode(apiRoot);
  return {
    mode: localMode ? "local" : "cloud",
    isLocalBotApiMode: localMode,
    limitBytes: localMode ? TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES : TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
    limitLabel: localMode ? "2000 МБ" : "50 МБ",
  };
}
