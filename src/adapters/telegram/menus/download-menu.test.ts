import { describe, expect, it, vi } from "vitest";
import { TelegramMenuSessionStore } from "../menu-session-store.js";
import type { SerializableFormatOption } from "../../../core/types.js";
import { MP3_FORMAT_ID } from "../../../core/format-selection.js";
import { createDownloadMenus, getRootActionAvailability } from "./download-menu.js";
import {
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_QUALITY_MENU_ID,
  createSyntheticMenuContext,
  renderMenuMarkup,
} from "./menu-state.js";

const enabledOption: SerializableFormatOption = {
  id: "18#mp4",
  value: "18#mp4",
  title: "360p | mp4",
  resolution: "360p",
  extension: "mp4",
  formatId: "18",
  container: "mp4",
  containerLabel: "MP4",
  kind: "single_file",
  height: 360,
  estimatedSizeBytes: 100,
  disabled: false,
  policy: { disabled: false, expectedSizeBytes: 100 },
};

const webmOption: SerializableFormatOption = {
  ...enabledOption,
  id: "247+251#webm",
  value: "247+251#webm",
  title: "720p | webm",
  resolution: "720p",
  extension: "webm",
  formatId: "247+251",
  container: "webm",
  containerLabel: "WEBM",
  kind: "merge",
  height: 720,
};

const disabledMp3Option: SerializableFormatOption = {
  id: MP3_FORMAT_ID,
  value: MP3_FORMAT_ID,
  title: "audio only | mp3",
  resolution: "audio only",
  extension: "mp3",
  formatId: "bestaudio",
  disabled: true,
  disabledReason: "unknown_size",
  policy: { disabled: true, reason: "unknown_size" },
};

describe("download menu", () => {
  it("renders root actions and dynamic quality options from the session store", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 10,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption, webmOption],
    });
    const menus = createDownloadMenus({
      store,
      onRootAction: vi.fn(async () => ({ jobId: "job-1" })),
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 10);
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text).join(" ")).toContain("360p");
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).toContain("Другие форматы");

    store.update({ chatId: "123", messageId: 10 }, { state: "quality", selectedContainer: "webm" });
    const qualityMarkup = await renderMenuMarkup(menus.qualityMenu, createSyntheticMenuContext("123", 10));
    expect(qualityMarkup.inline_keyboard.flat().map((button) => button.text).join(" ")).toContain("720p");
  });

  it("registers nested container and quality submenus under stable ids", () => {
    const menus = createDownloadMenus({
      store: new TelegramMenuSessionStore(),
      onRootAction: vi.fn(async () => ({ jobId: "job-1" })),
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    expect(menus.rootMenu.at(DOWNLOAD_CONTAINER_MENU_ID)).toBe(menus.containerMenu);
    expect(menus.rootMenu.at(DOWNLOAD_QUALITY_MENU_ID)).toBe(menus.qualityMenu);
  });

  it("does not allow root MP3 actions when the prepared MP3 option is disabled by policy", () => {
    expect(
      getRootActionAvailability({ formatOptions: [enabledOption, disabledMp3Option] }, "extract_mp3"),
    ).toEqual({ disabled: true, reason: "unknown_size" });
  });

  it("allows best download when a lower prepared format remains policy-allowed", () => {
    const disabledTopOption: SerializableFormatOption = {
      ...enabledOption,
      id: "137#mp4",
      value: "137#mp4",
      formatId: "137",
      resolution: "1080p",
      height: 1080,
      disabled: true,
      disabledReason: "too_large",
      policy: { disabled: true, reason: "too_large", expectedSizeBytes: 3 * 1024 * 1024 * 1024 },
    };

    expect(
      getRootActionAvailability({ formatOptions: [disabledTopOption, enabledOption] }, "download_best"),
    ).toEqual({ disabled: false });
  });

  it("shows MP4 video options on the root menu even when height is unknown", async () => {
    const instagramLikeMp4: SerializableFormatOption = {
      ...enabledOption,
      id: "ig#mp4",
      value: "ig#mp4",
      formatId: "ig",
      resolution: "unknown",
      height: undefined,
    };
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 11,
      url: "https://www.instagram.com/p/DWtdJ_pDVS2/",
      title: "Instagram",
      duration: 10,
      formatOptions: [instagramLikeMp4],
    });
    const menus = createDownloadMenus({
      store,
      onRootAction: vi.fn(async () => ({ jobId: "job-1" })),
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 11);
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text).join(" ")).toContain("unknown");
    expect(getRootActionAvailability({ formatOptions: [instagramLikeMp4] }, "download_best")).toEqual({
      disabled: false,
    });
  });
});
