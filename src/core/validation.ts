import net from "node:net";
import { invalidUrlError, liveStreamUnsupportedError } from "./errors.js";
import type { Video } from "./types.js";

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return numbers as [number, number, number, number];
}

function isBlockedIpv4Parts(parts: [number, number, number, number]): boolean {
  const [first, second, third] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first === 255 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

export function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;

  return isBlockedIpv4Parts(parts);
}

function parseIpv4MappedIpv6(hostname: string): [number, number, number, number] | undefined {
  if (!hostname.startsWith("::ffff:")) return undefined;

  const suffix = hostname.slice("::ffff:".length);
  const dotted = parseIpv4(suffix);
  if (dotted) return dotted;

  const groups = suffix.split(":");
  if (groups.length !== 2) return undefined;

  const first = Number.parseInt(groups[0] ?? "", 16);
  const second = Number.parseInt(groups[1] ?? "", 16);
  if ([first, second].some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return undefined;

  return [first >> 8, first & 0xff, second >> 8, second & 0xff];
}

function firstIpv6Segment(hostname: string): number {
  const segment = hostname.split(":").find((part) => part.length > 0);
  return Number.parseInt(segment ?? "0", 16);
}

function secondIpv6Segment(hostname: string): number {
  const segment = hostname.split(":").filter((part) => part.length > 0)[1];
  return Number.parseInt(segment ?? "0", 16);
}

export function isBlockedIpv6(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") return true;

  const mappedIpv4 = parseIpv4MappedIpv6(hostname);
  if (mappedIpv4) return isBlockedIpv4Parts(mappedIpv4);

  const first = firstIpv6Segment(hostname);
  const second = secondIpv6Segment(hostname);
  if (!Number.isInteger(first)) return true;

  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && (second === 0x0000 || second === 0x0db8)) ||
    first === 0x2002
  );
}

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;

  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan")) return true;
  if (!normalized.includes(".") && net.isIP(normalized) === 0) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isBlockedIpv4(normalized);
  if (ipVersion === 6) return isBlockedIpv6(normalized);

  return false;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isBlockedIpv4(normalized);
  if (ipVersion === 6) return isBlockedIpv6(normalized);
  return true;
}

export function isValidUrl(url: string): boolean {
  if (url.trim() !== url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isBlockedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function assertValidUrl(url: string): void {
  if (!isValidUrl(url)) {
    throw invalidUrlError();
  }
}

export function isLiveStream(video: Pick<Video, "live_status">): boolean {
  return video.live_status !== "not_live" && video.live_status !== undefined;
}

export function assertNotLiveStream(video: Pick<Video, "live_status">): void {
  if (isLiveStream(video)) {
    throw liveStreamUnsupportedError();
  }
}

export function parseHHMM(input: string): number {
  const parts = input.split(":");
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return parseInt(minutes) * 60 + parseInt(seconds);
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return parseInt(hours) * 60 * 60 + parseInt(minutes) * 60 + parseInt(seconds);
  }
  throw new Error("Invalid input");
}

export function isValidHHMM(input: string): boolean {
  try {
    if (input) {
      parseHHMM(input);
    }
    return true;
  } catch {
    return false;
  }
}
