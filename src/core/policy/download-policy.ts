import { TuitubeError } from "../errors.js";
import { getEstimatedFormatSize, getFormatValue } from "../format-selection.js";
import type { Format, PolicyReason, PolicyState, SerializableFormatOption, Video } from "../types.js";

export type UnknownSizePolicy = "reject" | "allow";

export type DownloadPolicyConfig = {
  maxFileSizeMb: number;
  minFreeDiskMb: number;
  unknownSizePolicy: UnknownSizePolicy;
  checkFreeDisk?: boolean;
};

export const defaultDownloadPolicy: DownloadPolicyConfig = {
  maxFileSizeMb: 1200,
  minFreeDiskMb: 6000,
  unknownSizePolicy: "reject",
  checkFreeDisk: true,
};

export const termcastCompatibilityDownloadPolicy: DownloadPolicyConfig = {
  maxFileSizeMb: Number.MAX_SAFE_INTEGER / 1024 / 1024,
  minFreeDiskMb: 0,
  unknownSizePolicy: "allow",
  checkFreeDisk: false,
};

export function mbToBytes(value: number): number {
  return value * 1024 * 1024;
}

function hasVideo(format: Format): boolean {
  return Boolean(format.vcodec) && format.vcodec !== "none";
}

function hasAudio(format: Format): boolean {
  return Boolean(format.acodec) && format.acodec !== "none";
}

export function findBestAudioFormat(video: Video): Format | undefined {
  return video.formats
    .filter((format) => hasAudio(format) && !hasVideo(format))
    .slice()
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
}

export function computeExpectedFormatSize(format: Format, video?: Video): number | undefined {
  const baseSize = getEstimatedFormatSize(format);
  if (hasVideo(format) && !hasAudio(format) && video) {
    const bestAudio = findBestAudioFormat(video);
    const audioSize = bestAudio ? getEstimatedFormatSize(bestAudio) : undefined;
    if (baseSize !== undefined && audioSize !== undefined) return baseSize + audioSize;
  }
  return baseSize;
}

export function evaluateDownloadPolicy({
  format,
  video,
  policy = defaultDownloadPolicy,
  freeDiskBytes,
}: {
  format: Format;
  video?: Video;
  policy?: DownloadPolicyConfig;
  freeDiskBytes?: number;
}): PolicyState {
  const expectedSizeBytes = computeExpectedFormatSize(format, video);
  const maxSizeBytes = mbToBytes(policy.maxFileSizeMb);
  const minFreeDiskBytes = mbToBytes(policy.minFreeDiskMb);
  const shouldCheckFreeDisk = policy.checkFreeDisk !== false;

  if (expectedSizeBytes === undefined && policy.unknownSizePolicy === "reject") {
    return {
      disabled: true,
      reason: "unknown_size",
      maxSizeBytes,
      freeDiskBytes,
      minFreeDiskBytes,
    };
  }

  if (expectedSizeBytes !== undefined && expectedSizeBytes > maxSizeBytes) {
    return {
      disabled: true,
      reason: "too_large",
      expectedSizeBytes,
      maxSizeBytes,
      freeDiskBytes,
      minFreeDiskBytes,
    };
  }

  if (
    shouldCheckFreeDisk &&
    freeDiskBytes !== undefined &&
    freeDiskBytes - (expectedSizeBytes ?? 0) < minFreeDiskBytes
  ) {
    return {
      disabled: true,
      reason: "insufficient_disk",
      expectedSizeBytes,
      maxSizeBytes,
      freeDiskBytes,
      minFreeDiskBytes,
    };
  }

  return {
    disabled: false,
    expectedSizeBytes,
    maxSizeBytes,
    freeDiskBytes,
    minFreeDiskBytes,
  };
}

export function attachPolicyState(
  options: SerializableFormatOption[],
  video: Video,
  policy: DownloadPolicyConfig = defaultDownloadPolicy,
  freeDiskBytes?: number,
): SerializableFormatOption[] {
  return options.map((option) => {
    const format = video.formats.find((candidate) => getFormatValue(candidate) === option.value);
    const policyState = format ? evaluateDownloadPolicy({ format, video, policy, freeDiskBytes }) : option.policy;

    return {
      ...option,
      estimatedSizeBytes: policyState.expectedSizeBytes ?? option.estimatedSizeBytes,
      disabled: policyState.disabled,
      disabledReason: policyState.reason,
      policy: policyState,
    };
  });
}

export function assertPolicyAllowed(policyState: PolicyState, details: Record<string, unknown> = {}): void {
  if (!policyState.disabled) return;

  const reason: PolicyReason = policyState.reason ?? "unknown_size";
  throw new TuitubeError({
    code: "POLICY_REJECTED",
    message: `Download rejected by policy: ${reason}`,
    severity: "warn",
    details: { ...policyState, ...details },
  });
}
