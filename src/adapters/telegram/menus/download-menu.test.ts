import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { TelegramMenuSessionStore } from "../menu-session-store.js";
import type { SerializableFormatOption } from "../../../core/types.js";
import type { TelegramMenuContext } from "../context.js";
import { MP3_FORMAT_ID } from "../../../core/format-selection.js";
import { TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES } from "../upload-limits.js";
import { createDownloadMenus, type DownloadMenus } from "./download-menu.js";
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

const botInfo: UserFromGetMe = {
  id: 123,
  is_bot: true,
  first_name: "Tuitube",
  username: "tuitube_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

async function invokeRootButton(
  menus: DownloadMenus,
  chatId: string,
  messageId: number,
  buttonText: string,
  options: { fromId?: number; chatType?: "private" | "group" | "supergroup" } = {},
): Promise<Array<{ method: string; payload: unknown }>> {
  const markup = await menus.renderRootMenuMarkup(chatId, messageId);
  const button = markup.inline_keyboard.flat().find((candidate) => candidate.text === buttonText) as
    | { callback_data?: string }
    | undefined;
  if (!button?.callback_data) throw new Error(`Button not found or has no callback data: ${buttonText}`);

  return invokeMenuCallback(menus, chatId, messageId, button.callback_data, options);
}

async function invokeMenuCallback(
  menus: DownloadMenus,
  chatId: string,
  messageId: number,
  callbackData: string,
  options: { fromId?: number; chatType?: "private" | "group" | "supergroup" } = {},
): Promise<Array<{ method: string; payload: unknown }>> {
  const bot = new Bot<TelegramMenuContext>("123:token", { botInfo });
  const calls: Array<{ method: string; payload: unknown }> = [];
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: true } as never;
  });
  bot.use(menus.rootMenu);

  await bot.handleUpdate({
    update_id: 1,
    callback_query: {
      id: "callback-1",
      from: { id: options.fromId ?? 1, is_bot: false, first_name: "User" },
      chat_instance: "instance-1",
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: Number(chatId), type: options.chatType ?? "private" },
        text: "menu",
      },
      data: callbackData,
    },
  } as never);

  return calls;
}

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

  it("keeps Other Formats on the root menu when no alternate video containers exist", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 13,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption],
    });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const calls = await invokeRootButton(menus, "123", 13, "Другие форматы");

    expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(calls[0]?.payload).toMatchObject({ text: "Этот вариант недоступен." });
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

  it("updates the original menu message to progress after format selection without follow-up replies", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 14,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption],
    });
    const onFormatSelected = vi.fn(async () => ({ jobId: "job-1" }));
    const menus = createDownloadMenus({
      store,
      onFormatSelected,
      onCancel: vi.fn(async () => undefined),
    });
    const buttonText = (await menus.renderRootMenuMarkup("123", 14)).inline_keyboard.flat()[0]?.text;

    const calls = await invokeRootButton(menus, "123", 14, buttonText ?? "");
    const lookup = store.get({ chatId: "123", messageId: 14 });

    expect(calls.map((call) => call.method)).not.toContain("sendMessage");
    expect(calls.map((call) => call.method)).toContain("editMessageText");
    expect(calls.find((call) => call.method === "editMessageText")?.payload).toMatchObject({
      text: expect.stringContaining("Скачивание запущено: 0 КБ / ~0.1 КБ"),
    });
    expect(lookup.status === "found" ? lookup.session.state : undefined).toBe("progress");
    expect(lookup.status === "found" ? lookup.session.activeJobId : undefined).toBe("job-1");
    expect(onFormatSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        formatValue: enabledOption.value,
        option: enabledOption,
      }),
    );
  });

  it("terminally cancels progress without redrawing a selectable menu", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 15,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption, webmOption, m4aOption],
    });
    store.markProgress({ chatId: "123", messageId: 15 }, { activeJobId: "job-1", expectedSizeBytes: 100 });
    const onCancel = vi.fn(async ({ ctx }) => {
      await ctx.editMessageText("Отменено.", { reply_markup: { inline_keyboard: [] } });
      store.delete({ chatId: "123", messageId: 15 });
      return { accepted: true as const, jobId: "job-1" };
    });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel,
    });

    const rootMarkup = await menus.renderRootMenuMarkup("123", 15);

    expect(rootMarkup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Назад", "Отмена"]);

    const cancelCalls = await invokeRootButton(menus, "123", 15, "Отмена");
    const afterCancel = store.get({ chatId: "123", messageId: 15 });
    const editCalls = cancelCalls.filter((call) => call.method === "editMessageText");
    expect(cancelCalls.map((call) => call.method)).toContain("answerCallbackQuery");
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]?.payload).toMatchObject({
      text: "Отменено.",
      reply_markup: { inline_keyboard: [] },
    });
    expect(JSON.stringify(editCalls[0]?.payload)).not.toContain("Выберите формат");
    expect(afterCancel.status).toBe("missing");
    expect(onCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ activeJobId: "job-1", state: "progress" }),
      }),
    );
  });

  it("back during progress cancels the active job and returns to the quality menu", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 16,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption, webmOption, m4aOption],
    });
    store.update({ chatId: "123", messageId: 16 }, { state: "quality", selectedContainer: "webm" });
    expect(store.tryMarkStarting({ chatId: "123", messageId: 16 }, { expectedSizeBytes: 100 }).status).toBe("started");
    store.markProgress({ chatId: "123", messageId: 16 }, { activeJobId: "job-1", expectedSizeBytes: 100 });
    const onCancel = vi.fn(async () => ({ accepted: true as const, jobId: "job-1" }));
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel,
    });

    const calls = await invokeRootButton(menus, "123", 16, "Назад");
    const lookup = store.get({ chatId: "123", messageId: 16 });
    const editCall = calls.find((call) => call.method === "editMessageText");

    expect(onCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveSession: true,
        session: expect.objectContaining({ activeJobId: "job-1", state: "progress" }),
      }),
    );
    expect(calls.map((call) => call.method)).toEqual(["editMessageText", "answerCallbackQuery"]);
    expect(editCall?.payload).toMatchObject({
      text: expect.stringContaining("Выберите формат:"),
    });
    expect(JSON.stringify(editCall?.payload)).toContain("720p");
    expect(calls.at(-1)?.payload).toMatchObject({ text: "Отменено." });
    expect(lookup.status === "found" ? lookup.session.state : undefined).toBe("quality");
    expect(lookup.status === "found" ? lookup.session.selectedContainer : undefined).toBe("webm");
    expect(lookup.status === "found" ? lookup.session.activeJobId : undefined).toBeUndefined();
    expect(lookup.status === "found" ? lookup.session.returnState : undefined).toBeUndefined();
  });

  it("does not create a second job from stale root callbacks after progress starts", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 17,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption, webmOption],
    });
    const onFormatSelected = vi.fn(async () => ({ jobId: "job-1" }));
    const onCancel = vi.fn(async () => undefined);
    const menus = createDownloadMenus({ store, onFormatSelected, onCancel });
    const rootMarkup = await menus.renderRootMenuMarkup("123", 17);
    const staleButton = rootMarkup.inline_keyboard.flat().find((button) => button.text.includes("360p")) as
      | { callback_data?: string }
      | undefined;
    if (!staleButton?.callback_data) throw new Error("missing stale callback data");

    await invokeMenuCallback(menus, "123", 17, staleButton.callback_data);
    await invokeMenuCallback(menus, "123", 17, staleButton.callback_data);

    expect(onFormatSelected).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders no working cancel button while a menu session is sending", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 18,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption],
    });
    store.update({ chatId: "123", messageId: 18 }, { state: "sending", activeJobId: "job-1" });
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel: vi.fn(async () => undefined),
    });

    const markup = await menus.renderRootMenuMarkup("123", 18);

    expect(markup.inline_keyboard.flat().map((button) => button.text)).not.toContain("Отмена");
    expect(markup.inline_keyboard.flat().map((button) => button.text)).not.toContain("Назад");
  });

  it("does not clear or redraw progress when cancellation is refused during sending", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "123",
      messageId: 19,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption],
      requesterUserId: "1",
    });
    store.markProgress({ chatId: "123", messageId: 19 }, { activeJobId: "job-1", expectedSizeBytes: 100 });
    const onCancel = vi.fn(async () => ({
      accepted: false as const,
      jobId: "job-1",
      previousStatus: "sending" as const,
      reason: "not_cancellable" as const,
    }));
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel,
    });

    const calls = await invokeRootButton(menus, "123", 19, "Отмена");
    const lookup = store.get({ chatId: "123", messageId: 19 });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(calls[0]?.payload).toMatchObject({ text: expect.stringContaining("Отправляю") });
    expect(lookup.status === "found" ? lookup.session.state : undefined).toBe("sending");
    expect(lookup.status === "found" ? lookup.session.activeJobId : undefined).toBe("job-1");
  });

  it("rejects state-changing progress callbacks from a different group user", async () => {
    const store = new TelegramMenuSessionStore();
    store.create({
      chatId: "-100123",
      messageId: 20,
      url: "https://example.com/video",
      title: "Title",
      duration: 30,
      formatOptions: [enabledOption],
      requesterUserId: "1",
    });
    store.markProgress({ chatId: "-100123", messageId: 20 }, { activeJobId: "job-1", expectedSizeBytes: 100 });
    const onCancel = vi.fn(async () => ({ accepted: true as const, jobId: "job-1" }));
    const menus = createDownloadMenus({
      store,
      onFormatSelected: vi.fn(async () => ({ jobId: "job-2" })),
      onCancel,
    });

    const calls = await invokeRootButton(menus, "-100123", 20, "Отмена", { fromId: 2, chatType: "group" });
    const lookup = store.get({ chatId: "-100123", messageId: 20 });

    expect(onCancel).not.toHaveBeenCalled();
    expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(calls[0]?.payload).toMatchObject({ text: expect.stringContaining("автору запроса") });
    expect(lookup.status === "found" ? lookup.session.state : undefined).toBe("progress");
    expect(lookup.status === "found" ? lookup.session.activeJobId : undefined).toBe("job-1");
  });
});
