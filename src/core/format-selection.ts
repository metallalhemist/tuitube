import type { DownloadPlan, DownloadPlanKind, Format, PolicyState, SerializableFormatOption, Video } from "./types.js";

const videoKey = "Video";
const audioOnlyKey = "Audio Only";

const videoContainers = new Set(["mp4", "webm", "mov", "mkv", "flv"]);
const audioContainers = new Set(["m4a", "aac", "mp3", "opus", "ogg", "wav", "flac", "weba"]);

export const MP3_FORMAT_ID = "bestaudio#mp3";

export type FormatGroups = {
  [videoKey]: Format[];
  [audioOnlyKey]: Format[];
};

export type FormatKind =
  | "muxed"
  | "video_only"
  | "audio_only"
  | "probably_muxed_direct"
  | "adaptive_unknown"
  | "unknown";

export type DownloadFormatChoice = {
  plan: DownloadPlan;
  value: string;
  formatId: string;
  extension: string;
  reason: "best_video" | "best_audio" | "requested";
};

export type FormatContainerOption = {
  container: string;
  label: string;
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

const mp3Plan: DownloadPlan = {
  id: MP3_FORMAT_ID,
  container: "mp3",
  containerLabel: "MP3 Audio",
  label: "Best - size unknown",
  estimatedSizeLabel: "size unknown",
  formatValue: MP3_FORMAT_ID,
  kind: "audio",
  formatId: "bestaudio",
  resolution: "Best",
  sourceFormats: [mp3Format],
  rank: 30,
};

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function hasVideoDimensions(format: Format): boolean {
  const resolution = normalized(format.resolution);
  return typeof format.width === "number" || typeof format.height === "number" || /\d+x\d+/.test(resolution);
}

function isAudioContainer(ext: string): boolean {
  return audioContainers.has(ext);
}

function isVideoContainer(ext: string): boolean {
  return videoContainers.has(ext);
}

function formatHeight(format: Format): number | undefined {
  if (typeof format.height === "number" && Number.isFinite(format.height)) return format.height;
  const resolutionMatch = normalized(format.resolution).match(/(\d{3,4})p/);
  if (resolutionMatch?.[1]) return Number(resolutionMatch[1]);
  return undefined;
}

function hasCodec({ vcodec, acodec }: Format) {
  return {
    hasVcodec: Boolean(vcodec) && vcodec !== "none",
    hasAcodec: Boolean(acodec) && acodec !== "none",
  };
}

export function classifyFormat(format: Format): FormatKind {
  const vcodec = normalized(format.vcodec);
  const acodec = normalized(format.acodec);
  const ext = normalized(format.ext);
  const protocol = normalized(format.protocol);
  const formatId = normalized(format.format_id);
  const formatNote = normalized(format.format_note);
  const resolution = normalized(format.resolution);
  const hasWidthHeight = hasVideoDimensions(format);

  const explicitlyAudioOnly =
    vcodec === "none" ||
    resolution === "audio only" ||
    formatNote.includes("audio only") ||
    (!hasWidthHeight && isAudioContainer(ext));

  const explicitlyVideoOnly = acodec === "none" || formatNote.includes("video only");

  const hasVideo =
    (vcodec !== "" && vcodec !== "none") || hasWidthHeight || (!explicitlyAudioOnly && isVideoContainer(ext));

  const hasAudio = acodec !== "" && acodec !== "none";

  const looksAdaptive =
    protocol.includes("dash") ||
    protocol.includes("m3u8") ||
    protocol.includes("hls") ||
    formatId.includes("dash") ||
    formatId.includes("hls") ||
    Array.isArray((format as { fragments?: unknown }).fragments);

  if (explicitlyAudioOnly) return "audio_only";
  if (hasVideo && explicitlyVideoOnly) return "video_only";
  if (hasVideo && hasAudio) return "muxed";

  if (hasVideo && !looksAdaptive && isVideoContainer(ext)) {
    return "probably_muxed_direct";
  }

  if (hasVideo && looksAdaptive) return "adaptive_unknown";

  return "unknown";
}

export function chooseMergeContainer(videoFormat: Format, audioFormat: Format): string | undefined {
  const vcodec = normalized(videoFormat.vcodec);
  const acodec = normalized(audioFormat.acodec);
  const audioExt = normalized(audioFormat.ext);

  const isH264 = vcodec.startsWith("avc1") || vcodec.includes("h264");
  const isAac = acodec.startsWith("mp4a") || acodec.includes("aac") || audioExt === "m4a" || audioExt === "aac";

  if (isH264 && isAac) {
    return "mp4";
  }

  const isVp8 = vcodec.startsWith("vp8");
  const isVp9 = vcodec.startsWith("vp9") || vcodec.startsWith("vp09");
  const isAv1 = vcodec.startsWith("av1") || vcodec.startsWith("av01");
  const isOpusOrVorbis =
    acodec.includes("opus") ||
    acodec.includes("vorbis") ||
    audioExt === "opus" ||
    audioExt === "weba" ||
    audioExt === "webm";

  if ((isVp8 || isVp9 || isAv1) && isOpusOrVorbis) {
    return "webm";
  }

  return undefined;
}

export function getFormats(video?: Video): FormatGroups {
  const videoFormats: Format[] = [];
  const audioOnly: Format[] = [];

  if (!video) return { [videoKey]: videoFormats, [audioOnlyKey]: audioOnly };

  audioOnly.push(mp3Format);

  for (const format of video.formats.slice().reverse()) {
    const kind = classifyFormat(format);
    if (kind === "audio_only") {
      audioOnly.push(format);
      continue;
    }
    if (kind !== "unknown") {
      videoFormats.push(format);
    }
  }

  return { [videoKey]: videoFormats, [audioOnlyKey]: audioOnly };
}

export function getFormatValue(format: Format): string {
  return `${format.format_id}#${format.ext}`;
}

export function formatTbr(tbr: number | null): string {
  if (!tbr) return "";
  return `${Math.floor(tbr)} kbps`;
}

export function formatFilesize(filesize?: number | null, filesizeApprox?: number | null): string {
  const size = normalizeEstimatedSize(filesize) ?? normalizeEstimatedSize(filesizeApprox);
  if (size === undefined) return "";

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
  return normalizeEstimatedSize(format.filesize) ?? normalizeEstimatedSize(format.filesize_approx);
}

export function normalizeEstimatedSize(size: number | null | undefined): number | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return undefined;
  return size;
}

function estimatedSizeLabel(size: number | undefined): string {
  return size === undefined ? "size unknown" : formatFilesize(size);
}

function combineEstimatedSizes(formats: Format[]): number | undefined {
  let total = 0;
  for (const format of formats) {
    const size = getEstimatedFormatSize(format);
    if (size === undefined) return undefined;
    total += size;
  }
  return total;
}

export function getContainerLabel(container: string, kind: DownloadPlanKind = "single_file"): string {
  const normalizedContainer = container.toLowerCase();
  const label = normalizedContainer.toUpperCase();
  if (kind === "audio" || audioContainers.has(normalizedContainer)) return `${label} Audio`;
  return label;
}

function videoQualityLabel(height: number): string {
  return `${height}p`;
}

function audioQualityLabel(format: Format): string {
  return formatTbr(format.tbr) || "Best";
}

function createPlan({
  container,
  kind,
  sourceFormats,
  formatValue,
  rank,
  height,
  qualityLabel,
}: {
  container: string;
  kind: DownloadPlanKind;
  sourceFormats: Format[];
  formatValue: string;
  rank: number;
  height?: number;
  qualityLabel: string;
}): DownloadPlan {
  const size = combineEstimatedSizes(sourceFormats);
  const sizeLabel = estimatedSizeLabel(size);
  const sourceFormatIds = sourceFormats.map((format) => format.format_id);

  return {
    id: formatValue,
    container,
    containerLabel: getContainerLabel(container, kind),
    height,
    label: `${qualityLabel} - ${sizeLabel}`,
    estimatedSizeBytes: size,
    estimatedSizeLabel: sizeLabel,
    formatValue,
    kind,
    formatId: sourceFormatIds.join("+"),
    resolution: qualityLabel,
    sourceFormats,
    rank,
  };
}

function dedupePlans(plans: DownloadPlan[]): DownloadPlan[] {
  const bestByKey = new Map<string, DownloadPlan>();

  for (const plan of plans) {
    const key =
      plan.kind === "audio" ? `${plan.container}:audio:${plan.resolution}` : `${plan.container}:video:${plan.height}`;
    const existing = bestByKey.get(key);
    if (!existing || comparePlans(plan, existing) < 0) {
      bestByKey.set(key, plan);
    }
  }

  return [...bestByKey.values()].sort(comparePlans);
}

function comparePlans(a: DownloadPlan, b: DownloadPlan): number {
  if (a.container === "mp4" && b.container !== "mp4") return -1;
  if (a.container !== "mp4" && b.container === "mp4") return 1;

  if (a.kind !== "audio" && b.kind === "audio") return -1;
  if (a.kind === "audio" && b.kind !== "audio") return 1;

  const heightDiff = (b.height ?? 0) - (a.height ?? 0);
  if (heightDiff !== 0) return heightDiff;

  const rankDiff = a.rank - b.rank;
  if (rankDiff !== 0) return rankDiff;

  const bitrateDiff = (b.sourceFormats[0]?.tbr ?? 0) - (a.sourceFormats[0]?.tbr ?? 0);
  if (bitrateDiff !== 0) return bitrateDiff;

  return a.formatValue.localeCompare(b.formatValue);
}

export function buildDownloadPlans(video?: Video): DownloadPlan[] {
  if (!video) return [];

  const plans: DownloadPlan[] = [];
  const audioFormats: Format[] = [];
  const videoOnlyFormats: Format[] = [];

  for (const format of video.formats) {
    const kind = classifyFormat(format);
    if (kind === "audio_only") {
      audioFormats.push(format);
      plans.push(
        createPlan({
          container: normalized(format.ext),
          kind: "audio",
          sourceFormats: [format],
          formatValue: getFormatValue(format),
          rank: 20,
          qualityLabel: audioQualityLabel(format),
        }),
      );
      continue;
    }

    if (kind === "muxed" || kind === "probably_muxed_direct") {
      const height = formatHeight(format);
      if (height === undefined) continue;
      plans.push(
        createPlan({
          container: normalized(format.ext),
          kind: "single_file",
          sourceFormats: [format],
          formatValue: getFormatValue(format),
          rank: kind === "muxed" ? 0 : 1,
          height,
          qualityLabel: videoQualityLabel(height),
        }),
      );
      continue;
    }

    if (kind === "video_only" || kind === "adaptive_unknown") {
      if (formatHeight(format) !== undefined) {
        videoOnlyFormats.push(format);
      }
    }
  }

  for (const videoFormat of videoOnlyFormats) {
    const height = formatHeight(videoFormat);
    if (height === undefined) continue;

    for (const audioFormat of audioFormats) {
      const container = chooseMergeContainer(videoFormat, audioFormat);
      if (!container) continue;
      plans.push(
        createPlan({
          container,
          kind: "merge",
          sourceFormats: [videoFormat, audioFormat],
          formatValue: `${videoFormat.format_id}+${audioFormat.format_id}#${container}`,
          rank: 10,
          height,
          qualityLabel: videoQualityLabel(height),
        }),
      );
    }
  }

  return dedupePlans(plans).filter((plan) => plan.container !== "dash");
}

export function isFirstScreenMp4Plan(plan: Pick<DownloadPlan, "container" | "height" | "kind">): boolean {
  return plan.container === "mp4" && plan.kind !== "audio";
}

export function isFirstScreenMp4Option(
  option: Pick<SerializableFormatOption, "container" | "extension" | "height" | "kind">,
): boolean {
  const container = option.container ?? option.extension;
  return container === "mp4" && option.kind !== "audio";
}

export function buildMp4Plans(video?: Video): DownloadPlan[] {
  return buildDownloadPlans(video).filter(isFirstScreenMp4Plan);
}

type SerializableFormatOptionContainerView = Pick<
  SerializableFormatOption,
  "container" | "containerLabel" | "extension" | "kind" | "value"
>;

function optionContainer(option: Pick<SerializableFormatOption, "container" | "extension">): string | undefined {
  return option.container ?? option.extension;
}

export function isAudioOnlyFormatOption(option: Pick<SerializableFormatOption, "kind" | "value">): boolean {
  return option.kind === "audio" || option.value === MP3_FORMAT_ID;
}

export function isVideoFormatOption(
  option: Pick<SerializableFormatOption, "container" | "extension" | "kind" | "value">,
): boolean {
  const container = optionContainer(option);
  return Boolean(container && container !== "dash" && !isAudioOnlyFormatOption(option));
}

export function getRootMp4FormatOptions(options: SerializableFormatOption[]): SerializableFormatOption[] {
  return options.filter(isFirstScreenMp4Option);
}

export function getVideoFormatContainers(
  options: SerializableFormatOptionContainerView[],
  { includeMp4 = false }: { includeMp4?: boolean } = {},
): FormatContainerOption[] {
  const labels = new Map<string, string>();

  for (const option of options) {
    if (!isVideoFormatOption(option)) continue;
    const container = optionContainer(option);
    if (!container) continue;
    if (!includeMp4 && container === "mp4") continue;
    labels.set(container, getContainerLabel(container, "single_file"));
  }

  return [...labels.entries()]
    .map(([container, label]) => ({ container, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getOtherVideoFormatContainers(
  options: SerializableFormatOptionContainerView[],
): FormatContainerOption[] {
  const hasRootMp4 = options.some((option) => {
    const container = optionContainer(option);
    return container === "mp4" && !isAudioOnlyFormatOption(option);
  });
  return getVideoFormatContainers(options, { includeMp4: !hasRootMp4 });
}

export function getFormatContainers(
  options: SerializableFormatOptionContainerView[],
  { includeMp4 = false }: { includeMp4?: boolean } = {},
): FormatContainerOption[] {
  return getVideoFormatContainers(options, { includeMp4 });
}

export function getVideoFormatOptionsForContainer(
  options: SerializableFormatOption[],
  container: string | undefined,
): SerializableFormatOption[] {
  if (!container) return [];
  return options.filter((option) => isVideoFormatOption(option) && optionContainer(option) === container);
}

export function getFormatOptionsForContainer(
  options: SerializableFormatOption[],
  container: string | undefined,
): SerializableFormatOption[] {
  return getVideoFormatOptionsForContainer(options, container);
}

export function getAudioFormatOptions(options: SerializableFormatOption[]): SerializableFormatOption[] {
  return options.filter(isAudioOnlyFormatOption);
}

function buildSerializableFormatOptionFromPlan(plan: DownloadPlan, policy?: PolicyState): SerializableFormatOption {
  const effectivePolicy = policy ?? {
    disabled: false,
    expectedSizeBytes: plan.estimatedSizeBytes,
  };

  return {
    id: plan.id,
    value: plan.formatValue,
    title: plan.label,
    resolution: plan.resolution,
    extension: plan.container,
    formatId: plan.formatId,
    container: plan.container,
    containerLabel: plan.containerLabel,
    kind: plan.kind,
    height: plan.height,
    label: plan.label,
    estimatedSizeLabel: plan.estimatedSizeLabel,
    sourceFormatIds: plan.sourceFormats.map((format) => format.format_id),
    estimatedSizeBytes: effectivePolicy.expectedSizeBytes ?? plan.estimatedSizeBytes,
    disabled: effectivePolicy.disabled,
    disabledReason: effectivePolicy.reason,
    policy: effectivePolicy,
  };
}

export function buildSerializableFormatOption(
  planOrFormat: DownloadPlan | Format,
  policy?: PolicyState,
): SerializableFormatOption {
  if ("formatValue" in planOrFormat) {
    return buildSerializableFormatOptionFromPlan(planOrFormat, policy);
  }

  const plan = createPlan({
    container: normalized(planOrFormat.ext),
    kind: classifyFormat(planOrFormat) === "audio_only" ? "audio" : "single_file",
    sourceFormats: [planOrFormat],
    formatValue: getFormatValue(planOrFormat),
    rank: 0,
    height: formatHeight(planOrFormat),
    qualityLabel: formatHeight(planOrFormat)
      ? videoQualityLabel(formatHeight(planOrFormat) ?? 0)
      : audioQualityLabel(planOrFormat),
  });
  return buildSerializableFormatOptionFromPlan(plan, policy);
}

export function buildSerializableFormatOptions(
  video: Video,
  getPolicy?: (plan: DownloadPlan) => PolicyState,
): SerializableFormatOption[] {
  const plans = buildDownloadPlans(video);
  const options = plans.map((plan) => buildSerializableFormatOptionFromPlan(plan, getPolicy?.(plan)));
  options.push(buildSerializableFormatOptionFromPlan(mp3Plan, getPolicy?.(mp3Plan)));
  return options;
}

export function chooseDownloadFormat(
  video: Video,
  requestedValue?: string,
  isAllowed?: (plan: DownloadPlan) => boolean,
): DownloadFormatChoice | undefined {
  const plans = buildDownloadPlans(video);

  if (requestedValue === MP3_FORMAT_ID) {
    return {
      plan: mp3Plan,
      value: mp3Plan.formatValue,
      formatId: mp3Plan.formatId,
      extension: mp3Plan.container,
      reason: "requested",
    };
  }

  if (requestedValue) {
    const requested = plans.find((plan) => plan.formatValue === requestedValue);
    if (requested) {
      return {
        plan: requested,
        value: requested.formatValue,
        formatId: requested.formatId,
        extension: requested.container,
        reason: "requested",
      };
    }
  }

  const bestVideo = plans.find((plan) => plan.kind !== "audio" && (isAllowed?.(plan) ?? true));
  if (bestVideo) {
    return {
      plan: bestVideo,
      value: bestVideo.formatValue,
      formatId: bestVideo.formatId,
      extension: bestVideo.container,
      reason: "best_video",
    };
  }

  const bestAudio = plans.find((plan) => plan.kind === "audio" && (isAllowed?.(plan) ?? true));
  if (bestAudio) {
    return {
      plan: bestAudio,
      value: bestAudio.formatValue,
      formatId: bestAudio.formatId,
      extension: bestAudio.container,
      reason: "best_audio",
    };
  }

  return undefined;
}
