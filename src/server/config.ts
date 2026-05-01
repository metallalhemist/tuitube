import path from "node:path";
import {
  createTelegramUploadPolicy,
  normalizeTelegramApiRoot,
  TelegramApiRootConfigError,
  type TelegramUploadPolicy,
} from "../adapters/telegram/upload-limits.js";
import { TuitubeError } from "../core/errors.js";
import { parseLogLevel, type LogLevel } from "../core/logger.js";
import { defaultDownloadPolicy, type DownloadPolicyConfig } from "../core/policy/download-policy.js";

export type TelegramConfig = {
  botToken: string;
  updateMode: "webhook" | "polling";
  webhookSecret?: string;
  webhookUrl?: string;
  webhookPath: "/telegram/webhook";
  apiRoot?: string;
  uploadPolicy: TelegramUploadPolicy;
};

export type ServerConfig = {
  host: string;
  port: number;
  requestTimeoutMs: number;
  webhookTimeoutMs: number;
  shutdownTimeoutMs: number;
  bodyLimitBytes: number;
  downloadDirectory: string;
  logLevel: LogLevel;
  maxConcurrentDownloads: number;
  maxQueueSize: number;
  commandTimeoutMs: number;
  processMaxBufferBytes: number;
  forceIpv4: boolean;
  pathEnv?: string;
  executables: {
    ytdlpPath?: string;
    ffmpegPath?: string;
    ffprobePath?: string;
  };
  policy: DownloadPolicyConfig;
  telegram: TelegramConfig;
};

function parseInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TuitubeError({
      code: "INVALID_CONFIG",
      message: `${name} must be an integer between ${min} and ${max}`,
      severity: "warn",
      details: { name, min, max },
    });
  }
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function validateWebhookSecret(secret: string | undefined): string | undefined {
  if (secret === undefined) return undefined;
  if (/^[A-Za-z0-9_-]{1,256}$/.test(secret)) return secret;
  throw new TuitubeError({
    code: "INVALID_CONFIG",
    message: "TELEGRAM_WEBHOOK_SECRET must be 1-256 characters and contain only A-Z, a-z, 0-9, _ or -",
    severity: "warn",
  });
}

export function buildWebhookUrl(publicUrl: string, webhookPath: string = "/telegram/webhook"): string {
  const url = new URL(publicUrl);
  const normalizedBase = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${normalizedBase}${webhookPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function redactWebhookUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const botToken = optionalString(env.TELEGRAM_BOT_TOKEN);
  if (!botToken) {
    throw new TuitubeError({
      code: "INVALID_CONFIG",
      message: "TELEGRAM_BOT_TOKEN is required",
      severity: "warn",
    });
  }
  const updateMode = env.TELEGRAM_UPDATE_MODE === "polling" ? "polling" : "webhook";
  const webhookSecret = validateWebhookSecret(optionalString(env.TELEGRAM_WEBHOOK_SECRET));
  if (updateMode === "webhook" && !webhookSecret) {
    throw new TuitubeError({
      code: "INVALID_CONFIG",
      message: "TELEGRAM_WEBHOOK_SECRET is required for Telegram webhook handling",
      severity: "warn",
    });
  }

  const downloadDirectory = path.resolve(optionalString(env.DOWNLOAD_DIR) ?? path.join(process.cwd(), "downloads"));
  let telegramApiRoot: string | undefined;
  try {
    telegramApiRoot = normalizeTelegramApiRoot(optionalString(env.TELEGRAM_API_ROOT));
  } catch (error) {
    throw new TuitubeError({
      code: "INVALID_CONFIG",
      message:
        error instanceof TelegramApiRootConfigError
          ? error.message
          : "TELEGRAM_API_ROOT must be a valid Bot API root URL",
      severity: "warn",
    });
  }
  const maxFileSizeMb = parseInteger(env, "MAX_FILE_SIZE_MB", defaultDownloadPolicy.maxFileSizeMb, {
    min: 1,
    max: 1024 * 50,
  });
  const minFreeDiskMb = parseInteger(env, "MIN_FREE_DISK_MB", defaultDownloadPolicy.minFreeDiskMb, {
    min: 0,
    max: 1024 * 100,
  });

  return {
    host: optionalString(env.HOST) ?? "0.0.0.0",
    port: parseInteger(env, "PORT", 3000, { min: 1, max: 65535 }),
    requestTimeoutMs: parseInteger(env, "SERVER_REQUEST_TIMEOUT_MS", 20_000, { min: 1_000, max: 300_000 }),
    webhookTimeoutMs: parseInteger(env, "WEBHOOK_TIMEOUT_MS", 9_000, { min: 1_000, max: 60_000 }),
    shutdownTimeoutMs: parseInteger(env, "SHUTDOWN_TIMEOUT_MS", 15_000, { min: 1_000, max: 300_000 }),
    bodyLimitBytes: parseInteger(env, "SERVER_BODY_LIMIT_BYTES", 1024 * 1024, { min: 1024, max: 50 * 1024 * 1024 }),
    downloadDirectory,
    logLevel: parseLogLevel(env.LOG_LEVEL, "info"),
    maxConcurrentDownloads: parseInteger(env, "MAX_CONCURRENT_DOWNLOADS", 1, { min: 1, max: 8 }),
    maxQueueSize: parseInteger(env, "MAX_QUEUE_SIZE", 5, { min: 1, max: 1000 }),
    commandTimeoutMs: parseInteger(env, "COMMAND_TIMEOUT_MS", 30 * 60 * 1000, { min: 1_000, max: 24 * 60 * 60 * 1000 }),
    processMaxBufferBytes: parseInteger(env, "PROCESS_MAX_BUFFER_BYTES", 20 * 1024 * 1024, {
      min: 1024,
      max: 1024 * 1024 * 1024,
    }),
    forceIpv4: parseBoolean(env.FORCE_IPV4),
    pathEnv: env.PATH,
    executables: {
      ytdlpPath: optionalString(env.YTDLP_PATH),
      ffmpegPath: optionalString(env.FFMPEG_PATH),
      ffprobePath: optionalString(env.FFPROBE_PATH),
    },
    policy: {
      maxFileSizeMb,
      minFreeDiskMb,
      unknownSizePolicy: env.UNKNOWN_SIZE_POLICY === "allow" ? "allow" : "reject",
    },
    telegram: {
      botToken,
      updateMode,
      webhookSecret,
      webhookUrl: optionalString(env.TELEGRAM_WEBHOOK_URL),
      webhookPath: "/telegram/webhook",
      apiRoot: telegramApiRoot,
      uploadPolicy: createTelegramUploadPolicy(telegramApiRoot),
    },
  };
}
