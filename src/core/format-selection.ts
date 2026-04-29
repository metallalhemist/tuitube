import type { Format, PolicyState, SerializableFormatOption, Video } from "./types.js";

const videoKey = "Video";
const audioOnlyKey = "Audio Only";

export const MP3_FORMAT_ID = "bestaudio#mp3";

export type FormatGroups = {
  [videoKey]: Format[];
  [audioOnlyKey]: Format[];
};

export type DownloadFormatChoice = {
  format: Format;
  value: string;
  formatId: string;
  extension: string;
  reason: "best_video" | "best_audio" | "requested";
};

const mp3Format: Format = {
  format_id: "bestaudio",
  ext: "mp3",
  video_ext: "none",
  protocol: "https",
  resolution: "audio only",
  vcodec: "none",
  acodec: "mp3",
  tbr: null,
  filesize: undefined,
  filesize_approx: undefined,
};

function hasCodec({ vcodec, acodec }: Format) {
  return {
    hasVcodec: Boolean(vcodec) && vcodec !== "none",
    hasAcodec: Boolean(acodec) && acodec !== "none",
  };
}

export function getFormats(video?: Video): FormatGroups {
  const videoWithAudio: Format[] = [];
  const audioOnly: Format[] = [];

  if (!video) return { [videoKey]: videoWithAudio, [audioOnlyKey]: audioOnly };

  audioOnly.push(mp3Format);

  for (const format of video.formats.slice().reverse()) {
    const { hasAcodec, hasVcodec } = hasCodec(format);
    if (hasVcodec) videoWithAudio.push(format);
    else if (hasAcodec && !hasVcodec) audioOnly.push(format);
  }

  return { [videoKey]: videoWithAudio, [audioOnlyKey]: audioOnly };
}

export function getFormatValue(format: Format): string {
  const { hasAcodec } = hasCodec(format);
  const audio = hasAcodec ? "" : "+bestaudio";
  const targetExt = `#${format.ext}`;
  return format.format_id + audio + targetExt;
}

export function formatTbr(tbr: number | null): string {
  if (!tbr) return "";
  return `${Math.floor(tbr)} kbps`;
}

export function formatFilesize(filesize?: number, filesizeApprox?: number): string {
  const size = filesize || filesizeApprox;
  if (!size) return "";

  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(2)} KiB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(2)} MiB`;
  return `${(size / 1024 ** 3).toFixed(2)} GiB`;
}

export function getFormatTitle(format: Format): string {
  return [format.resolution, format.ext, formatTbr(format.tbr), formatFilesize(format.filesize)]
    .filter((x) => Boolean(x))
    .join(" | ");
}

export function getEstimatedFormatSize(format: Format): number | undefined {
  return format.filesize ?? format.filesize_approx;
}

export function chooseDownloadFormat(
  video: Video,
  requestedValue?: string,
  isAllowed?: (format: Format) => boolean,
): DownloadFormatChoice | undefined {
  const formats = getFormats(video);
  const allFormats = [...formats[videoKey], ...formats[audioOnlyKey]];

  if (requestedValue) {
    const requested = allFormats.find((format) => getFormatValue(format) === requestedValue);
    if (requested) {
      return {
        format: requested,
        value: getFormatValue(requested),
        formatId: requested.format_id,
        extension: requested.ext,
        reason: "requested",
      };
    }
  }

  const bestVideo = formats[videoKey].find((format) => isAllowed?.(format) ?? true);
  if (bestVideo) {
    return {
      format: bestVideo,
      value: getFormatValue(bestVideo),
      formatId: bestVideo.format_id,
      extension: bestVideo.ext,
      reason: "best_video",
    };
  }

  const bestAudio = formats[audioOnlyKey].find((format) => isAllowed?.(format) ?? true);
  if (bestAudio) {
    return {
      format: bestAudio,
      value: getFormatValue(bestAudio),
      formatId: bestAudio.format_id,
      extension: bestAudio.ext,
      reason: "best_audio",
    };
  }

  return undefined;
}

export function buildSerializableFormatOption(format: Format, policy?: PolicyState): SerializableFormatOption {
  const effectivePolicy = policy ?? {
    disabled: false,
    expectedSizeBytes: getEstimatedFormatSize(format),
  };

  return {
    id: getFormatValue(format),
    value: getFormatValue(format),
    title: getFormatTitle(format),
    resolution: format.resolution,
    extension: format.ext,
    formatId: format.format_id,
    estimatedSizeBytes: effectivePolicy.expectedSizeBytes ?? getEstimatedFormatSize(format),
    disabled: effectivePolicy.disabled,
    disabledReason: effectivePolicy.reason,
    policy: effectivePolicy,
  };
}

export function buildSerializableFormatOptions(
  video: Video,
  getPolicy?: (format: Format) => PolicyState,
): SerializableFormatOption[] {
  const formats = getFormats(video);
  return [...formats[videoKey], ...formats[audioOnlyKey]].map((format) =>
    buildSerializableFormatOption(format, getPolicy?.(format)),
  );
}
