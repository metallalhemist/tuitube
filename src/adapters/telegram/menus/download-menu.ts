import { Menu, MenuRange } from "@grammyjs/menu";
import { normalizeError } from "../../../core/errors.js";
import { getOtherVideoFormatContainers, getRootMp4FormatOptions } from "../../../core/format-selection.js";
import { noopLogger, type Logger } from "../../../core/logger.js";
import type { SerializableFormatOption } from "../../../core/types.js";
import { formatOptionButtonLabel, telegramButtons, telegramCopy } from "../copy.js";
import type { TelegramMenuContext } from "../context.js";
import type { TelegramMenuSession, TelegramMenuSessionStore } from "../menu-session-store.js";
import { telegramDisplayPolicyForOption } from "../telegram-policy.js";
import { createTelegramUploadPolicy, type TelegramUploadPolicy } from "../upload-limits.js";
import { createAudioMenu, createContainerMenu, createFormatMenu, type FormatMenuActionHandler } from "./format-menu.js";
import { layoutMenuRows } from "./menu-layout.js";
import {
  DOWNLOAD_AUDIO_MENU_ID,
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_ROOT_MENU_ID,
  createSyntheticMenuContext,
  getMenuSessionLookup,
  menuFingerprint,
  renderMenuMarkup,
} from "./menu-state.js";

export type RootMenuCancelHandler = (input: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
}) => Promise<void>;

export type DownloadMenus = {
  rootMenu: Menu<TelegramMenuContext>;
  containerMenu: Menu<TelegramMenuContext>;
  qualityMenu: Menu<TelegramMenuContext>;
  audioMenu: Menu<TelegramMenuContext>;
  renderRootMenuMarkup(chatId: string, messageId: number): Promise<{
    inline_keyboard: import("grammy/types").InlineKeyboardButton[][];
  }>;
};

export function createDownloadMenus({
  store,
  onFormatSelected,
  onCancel,
  uploadPolicy = createTelegramUploadPolicy(undefined),
  logger = noopLogger,
}: {
  store: TelegramMenuSessionStore;
  onFormatSelected: FormatMenuActionHandler;
  onCancel: RootMenuCancelHandler;
  uploadPolicy?: TelegramUploadPolicy;
  logger?: Logger;
}): DownloadMenus {
  const rootMenu = new Menu<TelegramMenuContext>(DOWNLOAD_ROOT_MENU_ID, {
    autoAnswer: false,
    onMenuOutdated: telegramCopy.outdatedMenu,
    fingerprint: (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      return lookup.status === "found" ? menuFingerprint(lookup.session) : "missing";
    },
  });
  const containerMenu = createContainerMenu({ store, logger });
  const qualityMenu = createFormatMenu({ store, onFormatSelected, uploadPolicy, logger });
  const audioMenu = createAudioMenu({ store, onFormatSelected, uploadPolicy, logger });

  const runFormatSelection = (option: SerializableFormatOption) => async (ctx: TelegramMenuContext) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
      ctx.menu.close();
      return;
    }

    const displayPolicy = telegramDisplayPolicyForOption(option, uploadPolicy);
    logger.debug("telegram.menu.root.mp4_action", {
      sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
      formatId: option.formatId,
      disabled: option.disabled || displayPolicy.disabled,
      reason: option.disabledReason ?? displayPolicy.reason,
    });

    if (option.disabled || displayPolicy.disabled) {
      await ctx.answerCallbackQuery(telegramCopy.callbackDisabled);
      return;
    }

    let created: { jobId: string };
    try {
      created = await onFormatSelected({
        ctx,
        session: lookup.session,
        formatValue: option.value,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      logger.warn("telegram.menu.root.mp4_action_failed", { code: normalized.code, formatId: option.formatId });
      await ctx.answerCallbackQuery(normalized.code === "QUEUE_FULL" ? telegramCopy.queueFull : telegramCopy.failed);
      return;
    }

    store.update(lookup.key, { activeJobId: created.jobId, state: "closed" });
    ctx.menu.close();
    await ctx.answerCallbackQuery(telegramCopy.callbackAccepted).catch((error: unknown) => {
      logger.warn("telegram.menu.root.mp4_answer_failed", {
        formatId: option.formatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  rootMenu
    .dynamic((ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      if (lookup.status !== "found") {
        logger.warn("telegram.menu.root.render_missing", { status: lookup.status });
        return new MenuRange<TelegramMenuContext>();
      }

      const dynamicRange = new MenuRange<TelegramMenuContext>();
      const buttonItems = getRootMp4FormatOptions(lookup.session.formatOptions).map((option) => ({
        label: formatOptionButtonLabel(option, telegramDisplayPolicyForOption(option, uploadPolicy)),
        option,
      }));
      const rows = layoutMenuRows(buttonItems);
      logger.debug("telegram.menu.root.mp4_render", {
        sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
        optionCount: buttonItems.length,
        rowCount: rows.length,
        twoColumnRows: rows.filter((row) => row.length === 2).length,
      });
      for (const row of rows) {
        for (const item of row) {
          dynamicRange.text(item.label, runFormatSelection(item.option));
        }
        dynamicRange.row();
      }
      return dynamicRange;
    })
    .submenu(telegramButtons.otherFormats, DOWNLOAD_CONTAINER_MENU_ID, async (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      if (lookup.status === "found") {
        const containers = getOtherVideoFormatContainers(lookup.session.formatOptions);
        if (containers.length === 0) {
          await ctx.answerCallbackQuery(telegramCopy.callbackDisabled);
          return;
        }
        store.update(lookup.key, { state: "container", selectedContainer: undefined });
        logger.debug("telegram.menu.root.open_containers", {
          sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
          containerCount: containers.length,
        });
        await ctx.answerCallbackQuery(telegramCopy.callbackAccepted);
        return;
      }
      await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
    })
    .row()
    .submenu(telegramButtons.audio, DOWNLOAD_AUDIO_MENU_ID, async (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      if (lookup.status === "found") {
        store.update(lookup.key, { state: "audio", selectedContainer: undefined });
        logger.debug("telegram.menu.root.open_audio", {
          sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
          audioCount: lookup.session.formatOptions.filter((option) => option.kind === "audio").length,
        });
        await ctx.answerCallbackQuery(telegramCopy.callbackAccepted);
        return;
      }
      logger.warn("telegram.menu.root.open_audio_missing", { status: lookup.status });
      await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
    })
    .row()
    .text(telegramButtons.cancel, async (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      if (lookup.status !== "found") {
        await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
        ctx.menu.close();
        return;
      }

      logger.debug("telegram.menu.root.cancel", {
        sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
      });
      await onCancel({ ctx, session: lookup.session });
      store.delete(lookup.key);
      ctx.menu.close();
      await ctx.answerCallbackQuery(telegramCopy.cancelled);
    });

  rootMenu.register(containerMenu);
  rootMenu.register(qualityMenu, DOWNLOAD_CONTAINER_MENU_ID);
  rootMenu.register(audioMenu);

  return {
    rootMenu,
    containerMenu,
    qualityMenu,
    audioMenu,
    async renderRootMenuMarkup(chatId, messageId) {
      const ctx = createSyntheticMenuContext(chatId, messageId);
      return renderMenuMarkup(rootMenu, ctx);
    },
  };
}
