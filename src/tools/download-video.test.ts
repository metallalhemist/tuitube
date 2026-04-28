import { describe, expect, it, vi } from "vitest";

const videoDownloadServiceMock = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
}));

vi.mock("../utils.js", () => ({
  downloadPath: "/tmp",
  forceIpv4: false,
  getExtendedPath: () => "/safe/bin",
  getffmpegPath: () => "/bin/sh",
  getffprobePath: () => "/bin/sh",
  getytdlPath: () => "/bin/sh",
}));

vi.mock("../core/services/video-download-service.js", () => ({
  VideoDownloadService: class {
    constructor(options: unknown) {
      videoDownloadServiceMock.constructorOptions.push(options);
    }

    async download() {
      return {
        filePath: "/tmp/video.mp4",
        fileName: "video.mp4",
        title: "Video",
        duration: 42,
      };
    }
  },
}));

describe("download-video tool", () => {
  it("preserves the public return shape", async () => {
    const tool = (await import("./download-video.js")).default;
    await expect(tool({ url: "https://example.com/video" })).resolves.toEqual({
      downloadedPath: "/tmp/video.mp4",
      fileName: "video.mp4",
      title: "Video",
      duration: 42,
    });
    expect(videoDownloadServiceMock.constructorOptions[0]).toMatchObject({
      policy: {
        minFreeDiskMb: 0,
        unknownSizePolicy: "allow",
        checkFreeDisk: false,
      },
      env: { PATH: "/safe/bin", PYTHONUNBUFFERED: "1" },
    });
  });
});
