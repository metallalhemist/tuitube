import { Menu, MenuRange } from "@grammyjs/menu";
import { normalizeError } from "../../../core/errors.js";
import { getFormatContainers, getFormatOptionsForContainer } from "../../../core/format-selection.js";
import { noopLogger, type Logger } from "../../../core/logger.js";
import { formatOptionButtonLabel, telegramButtons, telegramCopy } from "../copy.js";
import { telegramDisplayPolicyForOption } from "../telegram-policy.js";
import type { TelegramMenuContext } from "../context.js";
import type { TelegramMenuSession, TelegramMenuSessionStore } from "../menu-session-store.js";
import {
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_QUALITY_MENU_ID,
  getMenuSessionLookup,
  menuFingerprint,
} from "./menu-state.js";

export type FormatMenuActionHandler = (input: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
  formatValue: string;
}) => Promise<{ jobId: string }>;

export function createContainerMenu({
  store,
  logger = noopLogger,
}: {
  store: TelegramMenuSessionStore;
  logger?: Logger;
}): Menu<TelegramMenuContext> {
  const menu = new Menu<TelegramMenuContext>(DOWNLOAD_CONTAINER_MENU_ID, {
    autoAnswer: false,
    onMenuOutdated: telegramCopy.outdatedMenu,
    fingerprint: (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      return lookup.status === "found" ? menuFingerprint(lookup.session) : "missing";
    },
  });

  menu.dynamic((ctx) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      logger.warn("telegram.menu.container.render_missing", { status: lookup.status });
      return new MenuRange<TelegramMenuContext>().text(telegramCopy.expiredSession, async (callbackCtx) => {
        await callbackCtx.answerCallbackQuery(telegramCopy.expiredSession);
        callbackCtx.menu.close();
      });
    }

    const dynamicRange = new MenuRange<TelegramMenuContext>();
    const containers = getFormatContainers(lookup.session.formatOptions, { includeMp4: true });
    for (const container of containers) {
      dynamicRange.text(container.label, async (callbackCtx) => {
        logger.debug("telegram.menu.container.action", {
          sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
          container: container.container,
        });
        store.update(lookup.key, { state: "quality", selectedContainer: container.container });
        await callbackCtx.menu.nav(DOWNLOAD_QUALITY_MENU_ID);
        await callbackCtx.answerCallbackQuery(telegramCopy.callbackAccepted);
      });
      dynamicRange.row();
    }

    return dynamicRange;
  });

  menu.back(telegramButtons.back, async (ctx) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status === "found") store.update(lookup.key, { state: "root", selectedContainer: undefined });
    await ctx.answerCallbackQuery(
      lookup.status === "found"
        ? telegramCopy.callbackAccepted
        : lookup.status === "expired"
          ? telegramCopy.expiredSession
          : telegramCopy.missingSession,
    );
  });

  return menu;
}

export function createFormatMenu({
  store,
  onFormatSelected,
  logger = noopLogger,
}: {
  store: TelegramMenuSessionStore;
  onFormatSelected: FormatMenuActionHandler;
  logger?: Logger;
}): Menu<TelegramMenuContext> {
  const menu = new Menu<TelegramMenuContext>(DOWNLOAD_QUALITY_MENU_ID, {
    autoAnswer: false,
    onMenuOutdated: telegramCopy.outdatedMenu,
    fingerprint: (ctx) => {
      const lookup = getMenuSessionLookup(ctx, store);
      return lookup.status === "found" ? menuFingerprint(lookup.session) : "missing";
    },
  });

  menu.dynamic((ctx, range) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      logger.warn("telegram.menu.format.render_missing", { status: lookup.status });
      return range.text(telegramCopy.expiredSession, async (callbackCtx) => {
        await callbackCtx.answerCallbackQuery(telegramCopy.expiredSession);
        callbackCtx.menu.close();
      });
    }

    logger.debug("telegram.menu.format.render", {
      chatId: lookup.key.chatId,
      messageId: lookup.key.messageId,
      selectedContainer: lookup.session.selectedContainer,
      formatCount: lookup.session.formatOptions.length,
    });

    const dynamicRange = new MenuRange<TelegramMenuContext>();
    const options = getFormatOptionsForContainer(lookup.session.formatOptions, lookup.session.selectedContainer);
    for (const option of options) {
      const displayPolicy = telegramDisplayPolicyForOption(option);
      dynamicRange.text(formatOptionButtonLabel(option, displayPolicy), async (callbackCtx) => {
        logger.debug("telegram.menu.format.action", {
          sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
          formatId: option.formatId,
          disabled: option.disabled || displayPolicy.disabled,
          reason: option.disabledReason ?? displayPolicy.reason,
        });

        if (option.disabled || displayPolicy.disabled) {
          await callbackCtx.answerCallbackQuery(telegramCopy.callbackDisabled);
          return;
        }

        let created: { jobId: string };
        try {
          created = await onFormatSelected({
            ctx: callbackCtx,
            session: lookup.session,
            formatValue: option.value,
          });
        } catch (error) {
          const normalized = normalizeError(error);
          logger.warn("telegram.menu.format.action_failed", { code: normalized.code, formatId: option.formatId });
          await callbackCtx.answerCallbackQuery(normalized.code === "QUEUE_FULL" ? telegramCopy.queueFull : telegramCopy.failed);
          return;
        }

        store.update(lookup.key, { activeJobId: created.jobId, state: "closed" });
        callbackCtx.menu.close();
        await callbackCtx.answerCallbackQuery(telegramCopy.callbackAccepted).catch((error: unknown) => {
          logger.warn("telegram.menu.format.answer_failed", {
            formatId: option.formatId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
      dynamicRange.row();
    }
    return dynamicRange;
  });

  menu.back(telegramButtons.back, async (ctx) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status === "found") store.update(lookup.key, { state: "container", selectedContainer: undefined });
    await ctx.answerCallbackQuery(
      lookup.status === "found"
        ? telegramCopy.callbackAccepted
        : lookup.status === "expired"
          ? telegramCopy.expiredSession
          : telegramCopy.missingSession,
    );
  });

  return menu;
}
