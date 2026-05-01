import { describe, expect, it, vi } from "vitest";
import { TelegramMenuSessionStore } from "../menu-session-store.js";
import type { SerializableFormatOption } from "../../../core/types.js";
import { MP3_FORMAT_ID } from "../../../core/format-selection.js";
import { TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES } from "../upload-limits.js";
import { createDownloadMenus } from "./download-menu.js";
import {
  DOWNLOAD_AUDIO_MENU_ID,
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_QUALITY_MENU_ID,
  createSyntheticMenuContext,
  renderMenuMarkup,
} from "./menu-state.js";
import { layoutMenuRows } from "./menu-layout.js";

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

const mp3Option: SerializableFormatOption = {
  id: MP3_FORMAT_ID,
  value: MP3_FORMAT_ID,
  title: "audio only | mp3",
  resolution: "Best",
  extension: "mp3",
  formatId: "bestaudio",
  container: "mp3",
  containerLabel: "MP3 Audio",
  kind: "audio",
  disabled: false,
  policy: { disabled: false },
};

const m4aOption: SerializableFormatOption = {
  ...mp3Option,
  id: "140#m4a",
  value: "140#m4a",
  title: "audio only | m4a",
  extension: "m4a",
  formatId: "140",
  container: "m4a",
  containerLabel: "M4A Audio",
  estimatedSizeBytes: 80,
};

const opusOption: SerializableFormatOption = {
  ...m4aOption,
  id: "251#opus",
  value: "251#opus",
  extension: "opus",
  formatId: "251",
  container: "opus",
  containerLabel: "OPUS Audio",
  estimatedSizeBytes: 90,
};

describe("download menu", () => {
  it("lays out short labels two per row and long labels one per row", () => {
    expect(layoutMenuRows([{ label: "360p" }, { label: "720p" }, { label: "1080p" }])).toEqual([
      [{ label: "360p" }, { label: "720p" }],
      [{ label: "1080p" }],
    ]);
    expect(
      layoutMenuRows([{ label: "720p - недоступно: ограничение сервера" }, { label: "M4A" }, { label: "MP3" }]),
    ).toEqual([[{ label: "720p - недоступно: ограничение сервера" }], [{ label: "M4A" }, { label: "MP3" }]]);
  });

  it("renders root actions and dynamic quality options from the session store", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 10,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [
        enabledOption,
        {
          ...enabledOption,
          id: "137+140#mp4",
          value: "137+140#mp4",
          formatId: "137+140",
          height: 1080,
          resolution: "1080p",
        },
        webmOption,
        m4aOption,
        opusOption,
        mp3Option,
      ],
    });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 10);
    expect(
      rootMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("360p");
    expect(rootMarkup.inline_keyboard[0]).toHaveLength(2);
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).toContain("Другие форматы");
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).toContain("Извлечь аудио");
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).not.toContain("Извлечь MP3");
    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).not.toContain("Извлечь расшифровку");

    const containerMarkup = await renderMenuMarkup(menus.containerMenu, createSyntheticMenuContext("123", 10));
    expect(containerMarkup.inline_keyboard.flat().map((button) => button.text)).toContain("WEBM");
    expect(containerMarkup.inline_keyboard.flat().map((button) => button.text)).not.toContain("MP4");
    expect(containerMarkup.inline_keyboard.flat().map((button) => button.text)).not.toContain("M4A");
    expect(containerMarkup.inline_keyboard.flat().map((button) => button.text)).not.toContain("MP3");

    store.update({ chatId: "123", messageId: 10 }, { state: "quality", selectedContainer: "webm" });
    const qualityMarkup = await renderMenuMarkup(menus.qualityMenu, createSyntheticMenuContext("123", 10));
    expect(
      qualityMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("720p");

    const audioMarkup = await renderMenuMarkup(menus.audioMenu, createSyntheticMenuContext("123", 10));
    expect(
      audioMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("M4A");
    expect(
      audioMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("OPUS");
    expect(
      audioMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("MP3");
  });

  it("keeps long rendered root, video, and audio labels on one-button rows", async () => {
    const largeMp4 = {
      ...enabledOption,
      estimatedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1,
      policy: { disabled: false, expectedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1 },
    };
    const largeWebm = {
      ...webmOption,
      estimatedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1,
      policy: { disabled: false, expectedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1 },
    };
    const largeAudio = {
      ...m4aOption,
      estimatedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1,
      policy: { disabled: false, expectedSizeBytes: TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES + 1 },
    };
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 12,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [largeMp4, enabledOption, largeWebm, webmOption, largeAudio, m4aOption],
    });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 12);
    expect(rootMarkup.inline_keyboard[0]).toHaveLength(1);

    store.update({ chatId: "123", messageId: 12 }, { state: "quality", selectedContainer: "webm" });
    const qualityMarkup = await renderMenuMarkup(menus.qualityMenu, createSyntheticMenuContext("123", 12));
    expect(qualityMarkup.inline_keyboard[0]).toHaveLength(1);

    const audioMarkup = await renderMenuMarkup(menus.audioMenu, createSyntheticMenuContext("123", 12));
    expect(audioMarkup.inline_keyboard[0]).toHaveLength(1);
  });

  it("registers nested container and quality submenus under stable ids", () => {
    const menus = createDownloadMenus({
      store: new TelegramMenuSessionStore(),
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    expect(menus.rootMenu.at(DOWNLOAD_CONTAINER_MENU_ID)).toBe(menus.containerMenu);
    expect(menus.rootMenu.at(DOWNLOAD_QUALITY_MENU_ID)).toBe(menus.qualityMenu);
    expect(menus.rootMenu.at(DOWNLOAD_AUDIO_MENU_ID)).toBe(menus.audioMenu);
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
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 11);
    expect(
      rootMarkup.inline_keyboard
        .flat()
        .map((button) => button.text)
        .join(" "),
    ).toContain("unknown");
  });
});
