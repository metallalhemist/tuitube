import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getFormatValue, buildSerializableFormatOptions, chooseDownloadFormat } from "./format-selection.js";
import { evaluateDownloadPolicy } from "./policy/download-policy.js";
import { sanitizeVideoTitle } from "./sanitize.js";
import { cleanUpSrt } from "./transcript/clean-srt.js";
import { isValidUrl } from "./validation.js";
import { createTempJobDirectory } from "./jobs/temp-job.js";
import type { Format, Video } from "./types.js";
import { fetchVideoMetadata, parsePrintedFilePath } from "../integrations/yt-dlp.js";
import { resolvePublicAddress } from "../integrations/egress-proxy.js";
import { mapProcessFailure, processFailureToError, redactCommandOutput, runBufferedCommand } from "../integrations/process.js";

const audio: Format = {
  format_id: "140",
  ext: "m4a",
  video_ext: "none",
  protocol: "https",
  resolution: "audio only",
  vcodec: "none",
  acodec: "mp4a",
  tbr: 128,
  filesize: 100,
};

const videoOnly: Format = {
  format_id: "137",
  ext: "mp4",
  video_ext: "mp4",
  protocol: "https",
  resolution: "1080p",
  vcodec: "avc1",
  acodec: "none",
  tbr: 2500,
  filesize: 500,
};

const combined: Format = {
  format_id: "18",
  ext: "mp4",
  video_ext: "mp4",
  protocol: "https",
  resolution: "360p",
  vcodec: "avc1",
  acodec: "mp4a",
  tbr: 800,
  filesize: 300,
};

const video: Video = {
  id: "abc",
  title: "Test",
  duration: 10,
  live_status: "not_live",
  formats: [audio, combined, videoOnly],
};

describe("core helpers", () => {
  it("validates URLs and sanitizes titles", () => {
    expect(isValidUrl("https://example.com/watch?v=1")).toBe(true);
    expect(isValidUrl("http://127.0.0.1/video")).toBe(false);
    expect(isValidUrl("http://10.0.0.1/video")).toBe(false);
    expect(isValidUrl("http://172.16.0.1/video")).toBe(false);
    expect(isValidUrl("http://192.168.1.1/video")).toBe(false);
    expect(isValidUrl("http://169.254.1.1/video")).toBe(false);
    expect(isValidUrl("http://192.0.2.1/video")).toBe(false);
    expect(isValidUrl("http://203.0.113.1/video")).toBe(false);
    expect(isValidUrl("http://[::1]/video")).toBe(false);
    expect(isValidUrl("http://[2001:4860:4860::8888]/video")).toBe(true);
    expect(isValidUrl("http://[2001:db8::1]/video")).toBe(false);
    expect(isValidUrl("ftp://example.com/video")).toBe(false);
    expect(isValidUrl("example.com/video")).toBe(false);
    expect(isValidUrl("not a url")).toBe(false);
    expect(sanitizeVideoTitle(" bad:name* ", "win32")).toBe("badname");
  });

  it("rejects unsafe URLs before invoking yt-dlp integrations", async () => {
    await expect(
      fetchVideoMetadata({
        url: "http://127.0.0.1/video",
        ytdlpPath: "/missing/yt-dlp",
        forceIpv4: false,
        timeoutMs: 1000,
        maxBufferBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("rejects private DNS results for yt-dlp egress proxying", async () => {
    await expect(
      resolvePublicAddress("media.example.com", {
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toThrow("private network address");

    await expect(
      resolvePublicAddress("media.example.com", {
        lookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow("private network address");

    await expect(
      resolvePublicAddress("media.example.com", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("chooses deterministic formats and serializes policy state", () => {
    const choice = chooseDownloadFormat(video);
    expect(choice?.formatId).toBe("137");
    expect(getFormatValue(videoOnly)).toBe("137+bestaudio#mp4");

    const options = buildSerializableFormatOptions(video, (format) =>
      evaluateDownloadPolicy({
        format,
        video,
        policy: { maxFileSizeMb: 1, minFreeDiskMb: 1, unknownSizePolicy: "reject" },
        freeDiskBytes: 4 * 1024 * 1024,
      }),
    );

    const option = options.find((candidate) => candidate.formatId === "137");
    expect(option?.estimatedSizeBytes).toBe(600);
    expect(option?.disabled).toBe(false);
  });

  it("returns explicit policy reasons for unknown size and insufficient disk", () => {
    expect(
      evaluateDownloadPolicy({
        format: { ...combined, filesize: undefined, filesize_approx: undefined },
        policy: { maxFileSizeMb: 1, minFreeDiskMb: 1, unknownSizePolicy: "reject" },
      }).reason,
    ).toBe("unknown_size");

    expect(
      evaluateDownloadPolicy({
        format: combined,
        policy: { maxFileSizeMb: 1, minFreeDiskMb: 1, unknownSizePolicy: "reject" },
        freeDiskBytes: 100,
      }).reason,
    ).toBe("insufficient_disk");
  });

  it("cleans SRT captions without duplicated rolling text", () => {
    const srt = `1
00:00:00,000 --> 00:00:01,000
Hello

2
00:00:01,000 --> 00:00:02,000
Hello world

3
00:00:02,000 --> 00:00:03,000
[Music] <i>world</i>`;

    expect(cleanUpSrt(srt)).toBe("Hello world");
  });

  it("creates and cleans per-job temp directories", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tuitube-test-"));
    try {
      const tempJob = await createTempJobDirectory({ baseDirectory: base, jobId: "job" });
      expect(tempJob.path.startsWith(base)).toBe(true);
      await tempJob.cleanup();
      await tempJob.cleanup();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("parses printed paths and maps process failures", () => {
    expect(parsePrintedFilePath("noise\n/tmp/file.mp4\n")).toBe("/tmp/file.mp4");
    expect(parsePrintedFilePath("noise\r\nC:\\\\Users\\\\me\\\\file.mp4\r\n")).toBe("C:\\\\Users\\\\me\\\\file.mp4");

    const failure = mapProcessFailure({ timedOut: true, stderr: "x".repeat(2000), code: "ETIMEDOUT" }, "/bin/tool");
    expect(failure.timedOut).toBe(true);
    expect(failure.stderrExcerpt.length).toBeLessThan(1300);
    const error = processFailureToError(failure);
    expect(error.code).toBe("PROCESS_TIMEOUT");
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("redacts URLs and token-like command output before storing failures", () => {
    const output =
      "failed https://example.com/video?Signature=abc&token=secret Authorization: Bearer abcdefghijklmnopqrstuvwxyz token=abcdef0123456789abcdef0123456789";

    expect(redactCommandOutput(output)).toBe("failed [url] Authorization: Bearer [redacted] token=[redacted]");

    const failure = mapProcessFailure({ stderr: output, stdout: "jwt aaa.bbb.ccc" }, "/bin/tool");
    expect(failure.stderrExcerpt).not.toContain("https://example.com");
    expect(failure.stderrExcerpt).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(failure.stderrExcerpt).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("runs commands with an allowlisted isolated environment", async () => {
    const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_BOT_TOKEN = "inherited-bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "inherited-webhook-secret";

    try {
      const script = `
        console.log(JSON.stringify({
          telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
          telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? null,
          pythonUnbuffered: process.env.PYTHONUNBUFFERED ?? null,
          httpProxy: process.env.HTTP_PROXY ?? null
        }));
      `;
      const result = await runBufferedCommand({
        executablePath: process.execPath,
        args: ["-e", script],
        timeoutMs: 1000,
        maxBufferBytes: 1024 * 1024,
        env: {
          TELEGRAM_BOT_TOKEN: "explicit-bot-token",
          TELEGRAM_WEBHOOK_SECRET: "explicit-webhook-secret",
          PYTHONUNBUFFERED: "1",
          HTTP_PROXY: "http://127.0.0.1:12345",
        },
      });
      const childEnv = JSON.parse(result.stdout) as Record<string, string | null>;

      expect(childEnv.telegramBotToken).toBeNull();
      expect(childEnv.telegramWebhookSecret).toBeNull();
      expect(childEnv.pythonUnbuffered).toBe("1");
      expect(childEnv.httpProxy).toBe("http://127.0.0.1:12345");
    } finally {
      if (originalBotToken === undefined) {
        delete process.env.TELEGRAM_BOT_TOKEN;
      } else {
        process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
      }

      if (originalWebhookSecret === undefined) {
        delete process.env.TELEGRAM_WEBHOOK_SECRET;
      } else {
        process.env.TELEGRAM_WEBHOOK_SECRET = originalWebhookSecret;
      }
    }
  });
});
