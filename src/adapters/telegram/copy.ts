import { MP3_FORMAT_ID } from "../../core/format-selection.js";
import type { PolicyReason, SerializableFormatOption } from "../../core/types.js";
import type { TelegramDisplayPolicyReason, TelegramDisplayPolicyState } from "./telegram-policy.js";

const TRANSCRIPT_MESSAGE_LIMIT = 3_500;

export function formatTelegramDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "длительность неизвестна";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatTelegramBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "неизвестный размер";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КиБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МиБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГиБ`;
}

function formatTelegramBytesIfKnown(bytes: number | undefined): string | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  return formatTelegramBytes(bytes);
}

export const telegramCopy = {
  start:
    "Привет. Пришлите ссылку на видео, и я покажу MP4, другие форматы и аудио для скачивания.",
  invalidUrl: "Не похоже на поддерживаемую ссылку. Пришлите полный URL, начинающийся с http:// или https://.",
  analyzingUrl: "Проверяю ссылку и готовлю варианты...",
  metadataFailed: "Не удалось подготовить варианты для этой ссылки. Попробуйте другую ссылку позже.",
  mainMenuTitle: (title: string, duration: number, options: { hasMp4WithoutRecoding?: boolean } = {}) => {
    const mp4Line =
      options.hasMp4WithoutRecoding === false
        ? "\nMP4 без перекодирования не найден. Выберите другой доступный формат."
        : "";
    return `Видео: ${title}\nДлительность: ${formatTelegramDuration(duration)}${mp4Line}\nВыберите формат:`;
  },
  expiredSession: "Меню устарело. Пришлите ссылку еще раз.",
  missingSession: "Не нашел данные для этого меню. Пришлите ссылку еще раз.",
  outdatedMenu: "Меню устарело, обновляю варианты.",
  queueAccepted: (jobId: string) => `Задача принята в очередь. ID: ${jobId}`,
  queueFull: "Очередь сейчас заполнена. Попробуйте позже.",
  running: "Задача выполняется.",
  completed: "Готово.",
  failed: "Не удалось выполнить задачу. Попробуйте позже.",
  cancelled: "Отменено.",
  transcriptMissing: "Для этого видео не найдены субтитры или расшифровка.",
  callbackAccepted: "Принято.",
  callbackDisabled: "Этот вариант недоступен.",
  downloadStarted: "Скачивание запущено.",
  transcriptStarted: "Извлечение расшифровки запущено.",
  sendingFileFailed: "Файл подготовлен, но отправить его в Telegram не удалось.",
  telegramUploadTooLarge: (limitLabel: string, mode: "cloud" | "local") =>
    mode === "local"
      ? `Файл слишком большой для Local Bot API: лимит ${limitLabel}. Выберите качество меньше.`
      : `Файл слишком большой для облачного Bot API Telegram: лимит ${limitLabel}. Выберите качество меньше или настройте Local Bot API для больших MP4.`,
  transcriptDocumentCaption: "Расшифровка во вложении.",
  transcriptMessageLimit: TRANSCRIPT_MESSAGE_LIMIT,
};

export const telegramButtons = {
  bestVideo: "Скачать лучшее видео",
  chooseQuality: "Выбрать качество",
  otherFormats: "Другие форматы",
  audio: "Извлечь аудио",
  cancel: "Отмена",
  back: "Назад",
};

export function policyReasonText(reason: TelegramDisplayPolicyReason | PolicyReason | undefined): string {
  switch (reason) {
    case "too_large":
      return "файл больше 2 ГиБ для Telegram";
    case "unknown_size":
      return "неизвестный размер";
    case "server_limit":
      return "ограничение сервера по размеру файла";
    case "insufficient_disk":
      return "недостаточно свободного места на сервере";
    case "queue_full":
      return "очередь заполнена";
    default:
      return "доступно";
  }
}

export function formatOptionButtonLabel(
  option: SerializableFormatOption,
  displayPolicy?: TelegramDisplayPolicyState,
): string {
  const size = formatTelegramBytesIfKnown(option.estimatedSizeBytes);
  const quality = option.kind === "audio" || option.value === MP3_FORMAT_ID ? audioFormatButtonLabel(option) : videoFormatButtonLabel(option);
  const reason = displayPolicy?.reason !== "allowed" ? displayPolicy?.reason : option.disabledReason;
  const suffix =
    reason && reason !== "unknown_size" && (option.disabled || displayPolicy?.disabled)
      ? ` - недоступно: ${policyReasonText(reason)}`
      : "";
  return `${size ? `${quality} · ${size}` : quality}${suffix}`;
}

export function videoFormatButtonLabel(option: Pick<SerializableFormatOption, "container" | "extension" | "height" | "resolution">): string {
  if (option.height) return `${option.height}p`;
  if (option.resolution && option.resolution !== "audio only") return option.resolution;
  return (option.container ?? option.extension).toUpperCase();
}

export function audioFormatButtonLabel(option: Pick<SerializableFormatOption, "container" | "extension" | "value">): string {
  if (option.value === MP3_FORMAT_ID) return "MP3";
  const container = (option.container ?? option.extension).toLowerCase();
  if (container === "webm" || container === "weba") return "WEBM Audio";
  return container.toUpperCase();
}

export function jobFailedText(code: string | undefined): string {
  if (code === "SUBTITLE_NOT_FOUND") return telegramCopy.transcriptMissing;
  if (code === "QUEUE_FULL") return telegramCopy.queueFull;
  if (code === "POLICY_REJECTED") return "Файл отклонен политикой сервера. Выберите другой вариант.";
  return telegramCopy.failed;
}

export function transcriptDeliveryMode(transcript: string): "message" | "document" {
  return transcript.length <= TRANSCRIPT_MESSAGE_LIMIT ? "message" : "document";
}
