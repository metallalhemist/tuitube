import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Video } from "../types.js";

const fetchVideoMetadata = vi.fn();
const downloadVideo = vi.fn();
const getFreeDiskSpaceBytes = vi.fn();

vi.mock("../../integrations/yt-dlp.js", () => ({
  fetchVideoMetadata,
  downloadVideo,
}));

vi.mock("../../integrations/filesystem.js", () => ({
  getFreeDiskSpaceBytes,
}));

const { VideoDownloadService } = await import("./video-download-service.js");

beforeEach(() => {
  fetchVideoMetadata.mockReset();
  downloadVideo.mockReset();
  getFreeDiskSpaceBytes.mockReset();
});

const video: Video = {
  id: "abc",
  title: "Test: Video",
  duration: 42,
  live_status: "not_live",
  formats: [
    {
      format_id: "18",
      ext: "mp4",
      video_ext: "mp4",
      protocol: "https",
      resolution: "360p",
      vcodec: "avc1",
      acodec: "mp4a",
      tbr: 800,
      filesize: 300,
    },
  ],
};

describe("VideoDownloadService", () => {
  it("builds a selection snapshot with a single metadata fetch", async () => {
    fetchVideoMetadata.mockResolvedValue(video);
    getFreeDiskSpaceBytes.mockResolvedValue({ freeBytes: 10 * 1024 * 1024 * 1024 });

    const service = new VideoDownloadService({
      ytdlpPath: "/bin/yt-dlp",
      downloadDirectory: "/tmp",
      timeoutMs: 1000,
      maxBufferBytes: 1024,
      forceIpv4: false,
    });

    const snapshot = await service.getSelectionSnapshot("https://example.com/video");

    expect(fetchVideoMetadata).toHaveBeenCalledTimes(1);
    expect(snapshot.title).toBe("Test Video");
    expect(snapshot.duration).toBe(42);
    expect(snapshot.formatOptions.map((option) => option.value)).toContain("18#mp4");
  });

  it("chooses the first policy-allowed default format instead of a disabled top format", async () => {
    fetchVideoMetadata.mockResolvedValue({
      ...video,
      formats: [
        {
          format_id: "18",
          ext: "mp4",
          video_ext: "mp4",
          protocol: "https",
          resolution: "360p",
          vcodec: "avc1",
          acodec: "mp4a",
          tbr: 800,
          filesize: 300,
        },
        {
          format_id: "137",
          ext: "mp4",
          video_ext: "mp4",
          protocol: "https",
          resolution: "1080p",
          vcodec: "avc1",
          acodec: "none",
          tbr: 3000,
          filesize: 2_000 * 1024 * 1024,
        },
      ],
    });
    getFreeDiskSpaceBytes.mockResolvedValue({ freeBytes: 10 * 1024 * 1024 * 1024 });
    downloadVideo.mockResolvedValue("/tmp/tuitube-test-video.mp4");

    const service = new VideoDownloadService({
      ytdlpPath: "/bin/yt-dlp",
      downloadDirectory: "/tmp",
      timeoutMs: 1000,
      maxBufferBytes: 1024,
      forceIpv4: false,
      policy: {
        maxFileSizeMb: 1200,
        minFreeDiskMb: 0,
        unknownSizePolicy: "reject",
        checkFreeDisk: true,
      },
    });

    const result = await service.download({ url: "https://example.com/video" });

    expect(result.fileName).toBe("tuitube-test-video.mp4");
    expect(downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ formatValue: "18#mp4" }));
    await result.cleanup();
  });
});
