import { Menu, MenuRange } from "@grammyjs/menu";
import { normalizeError } from "../../../core/errors.js";
import { getFormatContainers, isFirstScreenMp4Option, MP3_FORMAT_ID } from "../../../core/format-selection.js";
import { noopLogger, type Logger } from "../../../core/logger.js";
import type { PolicyReason, SerializableFormatOption } from "../../../core/types.js";
import { formatOptionButtonLabel, policyReasonText, telegramButtons, telegramCopy } from "../copy.js";
import type { TelegramMenuContext } from "../context.js";
import type { TelegramMenuSession, TelegramMenuSessionStore } from "../menu-session-store.js";
import { telegramDisplayPolicyForOption } from "../telegram-policy.js";
import { createContainerMenu, createFormatMenu, type FormatMenuActionHandler } from "./format-menu.js";
import {
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_ROOT_MENU_ID,
  createSyntheticMenuContext,
  getMenuSessionLookup,
  menuFingerprint,
  renderMenuMarkup,
} from "./menu-state.js";

export type RootMenuAction = "download_best" | "extract_mp3" | "extract_transcript";

export type RootMenuActionHandler = (input: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
  action: RootMenuAction;
}) => Promise<{ jobId: string }>;

export type RootMenuCancelHandler = (input: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
}) => Promise<void>;

export type RootActionAvailability = {
  disabled: boolean;
  reason?: PolicyReason;
};

export type DownloadMenus = {
  rootMenu: Menu<TelegramMenuContext>;
  containerMenu: Menu<TelegramMenuContext>;
  qualityMenu: Menu<TelegramMenuContext>;
  renderRootMenuMarkup(chatId: string, messageId: number): Promise<{
    inline_keyboard: import("grammy/types").InlineKeyboardButton[][];
  }>;
};

function optionAvailable(option: SerializableFormatOption | undefined): boolean {
  if (!option) return false;
  return !option.disabled && !telegramDisplayPolicyForOption(option).disabled;
}

function optionUnavailableReason(option: SerializableFormatOption | undefined): PolicyReason {
  if (!option) return "unknown_size";
  const displayPolicy = telegramDisplayPolicyForOption(option);
  if (displayPolicy.disabled && displayPolicy.reason !== "allowed" && displayPolicy.reason !== "server_limit") {
    return displayPolicy.reason;
  }
  return option.disabledReason ?? "unknown_size";
}

export function getRootActionAvailability(
  session: Pick<TelegramMenuSession, "formatOptions">,
  action: RootMenuAction,
): RootActionAvailability {
  if (action === "extract_transcript") return { disabled: false };

  if (action === "extract_mp3") {
    const mp3Option = session.formatOptions.find((option) => option.value === MP3_FORMAT_ID);
    return optionAvailable(mp3Option) ? { disabled: false } : { disabled: true, reason: optionUnavailableReason(mp3Option) };
  }

  return session.formatOptions.some((option) => isFirstScreenMp4Option(option) && optionAvailable(option))
    ? { disabled: false }
    : { disabled: true, reason: optionUnavailableReason(session.formatOptions[0]) };
}

export function createDownloadMenus({
  store,
  onRootAction,
  onFormatSelected,
  onCancel,
  logger = noopLogger,
}: {
  store: TelegramMenuSessionStore;
  onRootAction: RootMenuActionHandler;
  onFormatSelected: FormatMenuActionHandler;
  onCancel: RootMenuCancelHandler;
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
  const qualityMenu = createFormatMenu({ store, onFormatSelected, logger });

  const rootActionLabel = (label: string, action: RootMenuAction) => (ctx: TelegramMenuContext): string => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") return label;

    const availability = getRootActionAvailability(lookup.session, action);
    return availability.disabled ? `${label} - недоступно: ${policyReasonText(availability.reason)}` : label;
  };

  const runRootAction = (action: RootMenuAction) => async (ctx: TelegramMenuContext) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      logger.warn("telegram.menu.root.action_missing", { action, status: lookup.status });
      await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
      ctx.menu.close();
      return;
    }

    logger.debug("telegram.menu.root.action", {
      sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
      action,
    });
    const availability = getRootActionAvailability(lookup.session, action);
    if (availability.disabled) {
      logger.debug("telegram.menu.root.action_disabled", { action, reason: availability.reason });
      await ctx.answerCallbackQuery(telegramCopy.callbackDisabled);
      return;
    }

    let created: { jobId: string };
    try {
      created = await onRootAction({ ctx, session: lookup.session, action });
    } catch (error) {
      const normalized = normalizeError(error);
      logger.warn("telegram.menu.root.action_failed", { action, code: normalized.code });
      await ctx.answerCallbackQuery(normalized.code === "QUEUE_FULL" ? telegramCopy.queueFull : telegramCopy.failed);
      return;
    }

    store.update(lookup.key, { activeJobId: created.jobId, state: "closed" });
    ctx.menu.close();
    await ctx.answerCallbackQuery(telegramCopy.callbackAccepted).catch((error: unknown) => {
      logger.warn("telegram.menu.root.answer_failed", {
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const runFormatSelection = (option: SerializableFormatOption) => async (ctx: TelegramMenuContext) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      await ctx.answerCallbackQuery(lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession);
      ctx.menu.close();
      return;
    }

    const displayPolicy = telegramDisplayPolicyForOption(option);
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
      for (const option of lookup.session.formatOptions.filter(isFirstScreenMp4Option)) {
        dynamicRange.text(formatOptionButtonLabel(option, telegramDisplayPolicyForOption(option)), runFormatSelection(option));
        dynamicRange.row();
      }
      return dynamicRange;
    })
    .submenu(telegramButtons.otherFormats, DOWNLOAD_CONTAINER_MENU_ID, async (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      if (lookup.status === "found") {
        const containers = getFormatContainers(lookup.session.formatOptions, { includeMp4: true });
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
    .text(rootActionLabel(telegramButtons.mp3, "extract_mp3"), runRootAction("extract_mp3"))
    .row()
    .text(rootActionLabel(telegramButtons.transcript, "extract_transcript"), runRootAction("extract_transcript"))
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

  return {
    rootMenu,
    containerMenu,
    qualityMenu,
    async renderRootMenuMarkup(chatId, messageId) {
      const ctx = createSyntheticMenuContext(chatId, messageId);
      return renderMenuMarkup(rootMenu, ctx);
    },
  };
}
