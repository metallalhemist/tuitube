import { Menu, MenuRange } from "@grammyjs/menu";
import { normalizeError } from "../../../core/errors.js";
import type { JobStatus } from "../../../core/jobs/queue.js";
import {
  getOtherVideoFormatContainers,
  getRootMp4FormatOptions,
} from "../../../core/format-selection.js";
import { noopLogger, type Logger } from "../../../core/logger.js";
import type { SerializableFormatOption } from "../../../core/types.js";
import { formatOptionButtonLabel, telegramButtons, telegramCopy } from "../copy.js";
import type { TelegramMenuContext } from "../context.js";
import type {
  TelegramMenuSession,
  TelegramMenuSessionKey,
  TelegramMenuSessionStore,
} from "../menu-session-store.js";
import { createInitialTelegramProgressView, renderTelegramDownloadProgressText } from "../progress-message.js";
import { sanitizeTelegramError, telegramErrorReasonCode, telegramErrorStatusCode } from "../telegram-error.js";
import { telegramDisplayPolicyForOption } from "../telegram-policy.js";
import { createTelegramUploadPolicy, type TelegramUploadPolicy } from "../upload-limits.js";
import { createAudioMenu, createContainerMenu, createFormatMenu, type FormatMenuActionHandler } from "./format-menu.js";
import { layoutMenuRows } from "./menu-layout.js";
import {
  DOWNLOAD_AUDIO_MENU_ID,
  DOWNLOAD_CONTAINER_MENU_ID,
  DOWNLOAD_ROOT_MENU_ID,
  answerUnauthorizedMenuCallback,
  createSyntheticMenuContext,
  getMenuSessionLookup,
  isMenuSessionBusy,
  menuFingerprint,
  renderMenuMarkup,
} from "./menu-state.js";

export type RootMenuCancelResult =
  | { accepted: true; jobId?: string; previousStatus?: JobStatus }
  | {
      accepted: false;
      jobId?: string;
      previousStatus?: JobStatus;
      reason?: "missing_active_job" | "not_cancellable" | "unknown";
    };

export type RootMenuCancelHandler = (input: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
}) => Promise<RootMenuCancelResult | void>;

export type DownloadMenus = {
  rootMenu: Menu<TelegramMenuContext>;
  containerMenu: Menu<TelegramMenuContext>;
  qualityMenu: Menu<TelegramMenuContext>;
  audioMenu: Menu<TelegramMenuContext>;
  renderRootMenuMarkup(
    chatId: string,
    messageId: number,
  ): Promise<{
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

  const interruptProgress = async (
    callbackCtx: TelegramMenuContext,
    key: TelegramMenuSessionKey,
    session: TelegramMenuSession,
    target: "root" | "return",
  ): Promise<void> => {
    const activeJobId = session.activeJobId;
    if (!activeJobId) {
      logger.warn("telegram.menu.root.progress_interrupt_missing_job", {
        chatId: key.chatId,
        messageId: key.messageId,
      });
      await callbackCtx.answerCallbackQuery(telegramCopy.missingSession);
      return;
    }

    let cancelResult: RootMenuCancelResult | void;
    try {
      cancelResult = await onCancel({ ctx: callbackCtx, session });
    } catch (error) {
      const normalized = normalizeError(error);
      logger.warn("telegram.menu.root.progress_interrupt_cancel_failed", {
        jobId: activeJobId,
        code: normalized.code,
      });
      await callbackCtx.answerCallbackQuery(telegramCopy.failed);
      return;
    }

    if (cancelResult?.accepted === false) {
      if (cancelResult.previousStatus === "sending") {
        store.update(key, { state: "sending", activeJobId });
      }
      logger.warn("telegram.menu.root.progress_interrupt_cancel_refused", {
        jobId: activeJobId,
        target,
        previousStatus: cancelResult.previousStatus,
        reason: cancelResult.reason,
      });
      await callbackCtx.answerCallbackQuery(
        cancelResult.previousStatus === "sending" ? telegramCopy.sendingFile : telegramCopy.running,
      );
      return;
    }

    const deleted = store.delete(key);
    logger.info("telegram.menu.root.progress_interrupt", {
      jobId: activeJobId,
      target,
      deleted,
    });
    await callbackCtx.answerCallbackQuery(telegramCopy.cancelled);
  };

  const runFormatSelection = (option: SerializableFormatOption) => async (ctx: TelegramMenuContext) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      await ctx.answerCallbackQuery(
        lookup.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession,
      );
      ctx.menu.close();
      return;
    }

    if (
      await answerUnauthorizedMenuCallback({
        ctx,
        session: lookup.session,
        logger,
        event: "telegram.menu.root.mp4_unauthorized",
      })
    ) {
      return;
    }

    if (isMenuSessionBusy(lookup.session)) {
      logger.info("telegram.menu.root.duplicate_ignored", {
        chatId: lookup.key.chatId,
        messageId: lookup.key.messageId,
        activeJobId: lookup.session.activeJobId,
      });
      await ctx.answerCallbackQuery(telegramCopy.running);
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

    const starting = store.tryMarkStarting(lookup.key, { expectedSizeBytes: option.estimatedSizeBytes });
    if (starting.status === "busy") {
      logger.info("telegram.menu.root.duplicate_ignored", {
        chatId: lookup.key.chatId,
        messageId: lookup.key.messageId,
        activeJobId: starting.session.activeJobId,
      });
      await ctx.answerCallbackQuery(telegramCopy.running);
      return;
    }
    if (starting.status !== "started") {
      await ctx.answerCallbackQuery(
        starting.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession,
      );
      return;
    }

    let created: { jobId: string };
    try {
      created = await onFormatSelected({
        ctx,
        session: starting.session,
        formatValue: option.value,
        option,
      });
    } catch (error) {
      store.update(lookup.key, {
        state: starting.previousState,
        selectedContainer: starting.previousSelectedContainer,
        activeJobId: undefined,
        expectedSizeBytes: undefined,
        returnState: undefined,
        returnSelectedContainer: undefined,
      });
      const normalized = normalizeError(error);
      logger.warn("telegram.menu.root.mp4_action_failed", { code: normalized.code, formatId: option.formatId });
      await ctx.answerCallbackQuery(normalized.code === "QUEUE_FULL" ? telegramCopy.queueFull : telegramCopy.failed);
      return;
    }

    store.markProgress(lookup.key, { activeJobId: created.jobId, expectedSizeBytes: option.estimatedSizeBytes });
    const replyMarkup = await renderMenuMarkup(
      rootMenu,
      createSyntheticMenuContext(lookup.key.chatId, lookup.key.messageId),
    );
    try {
      logger.debug("telegram.menu.root.initial_progress_edit", {
        jobId: created.jobId,
        chatId: lookup.key.chatId,
        menuMessageId: lookup.key.messageId,
        hasExpectedSizeBytes: typeof option.estimatedSizeBytes === "number",
      });
      await ctx.editMessageText(
        renderTelegramDownloadProgressText(createInitialTelegramProgressView(option.estimatedSizeBytes)),
        { reply_markup: replyMarkup },
      );
    } catch (error) {
      logger.warn("telegram.menu.root.initial_progress_edit_failed", {
        jobId: created.jobId,
        statusCode: telegramErrorStatusCode(error),
        reason: telegramErrorReasonCode(error),
        error: sanitizeTelegramError(error),
      });
    }
    await ctx.answerCallbackQuery(telegramCopy.callbackAccepted).catch((error: unknown) => {
      logger.warn("telegram.menu.root.mp4_answer_failed", {
        formatId: option.formatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  rootMenu.dynamic((ctx) => {
    const lookup = getMenuSessionLookup(ctx, store);
    if (lookup.status !== "found") {
      logger.warn("telegram.menu.root.render_missing", { status: lookup.status });
      return new MenuRange<TelegramMenuContext>();
    }

    const dynamicRange = new MenuRange<TelegramMenuContext>();
    if (isMenuSessionBusy(lookup.session)) {
      if (lookup.session.state === "sending") {
        logger.debug("telegram.menu.root.sending_render", {
          chatId: lookup.key.chatId,
          messageId: lookup.key.messageId,
          jobId: lookup.session.activeJobId,
        });
        return dynamicRange;
      }

      logger.debug("telegram.menu.root.progress_render", {
        chatId: lookup.key.chatId,
        messageId: lookup.key.messageId,
        jobId: lookup.session.activeJobId,
      });
      dynamicRange
        .text(telegramButtons.back, async (callbackCtx) => {
          const current = store.get(lookup.key);
          if (current.status !== "found" || !current.session.activeJobId) {
            logger.warn("telegram.menu.root.progress_back_missing", {
              chatId: lookup.key.chatId,
              messageId: lookup.key.messageId,
              status: current.status,
            });
            await callbackCtx.answerCallbackQuery(telegramCopy.missingSession);
            return;
          }
          if (
            await answerUnauthorizedMenuCallback({
              ctx: callbackCtx,
              session: current.session,
              logger,
              event: "telegram.menu.root.progress_back_unauthorized",
            })
          ) {
            return;
          }
          if (current.session.state === "sending") {
            await callbackCtx.answerCallbackQuery(telegramCopy.sendingFile);
            return;
          }

          logger.info("telegram.menu.root.progress_back", { jobId: current.session.activeJobId });
          await callbackCtx.answerCallbackQuery(telegramCopy.running);
        })
        .text(telegramButtons.cancel, async (callbackCtx) => {
          const current = store.get(lookup.key);
          if (current.status !== "found" || !current.session.activeJobId) {
            logger.warn("telegram.menu.root.progress_cancel_missing", {
              chatId: lookup.key.chatId,
              messageId: lookup.key.messageId,
            });
            await callbackCtx.answerCallbackQuery(telegramCopy.missingSession);
            return;
          }
          if (
            await answerUnauthorizedMenuCallback({
              ctx: callbackCtx,
              session: current.session,
              logger,
              event: "telegram.menu.root.progress_cancel_unauthorized",
            })
          ) {
            return;
          }
          if (current.session.state === "sending") {
            await callbackCtx.answerCallbackQuery(telegramCopy.sendingFile);
            return;
          }

          logger.info("telegram.menu.root.progress_cancel", { jobId: current.session.activeJobId });
          await interruptProgress(callbackCtx, lookup.key, current.session, "root");
        });
      return dynamicRange;
    }

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

    dynamicRange
      .text(telegramButtons.otherFormats, async (callbackCtx) => {
        const current = store.get(lookup.key);
        if (
          current.status === "found" &&
          (await answerUnauthorizedMenuCallback({
            ctx: callbackCtx,
            session: current.session,
            logger,
            event: "telegram.menu.root.open_containers_unauthorized",
          }))
        ) {
          return;
        }
        if (current.status === "found" && isMenuSessionBusy(current.session)) {
          await callbackCtx.answerCallbackQuery(telegramCopy.running);
          return;
        }
        if (current.status === "found") {
          const containers = getOtherVideoFormatContainers(current.session.formatOptions);
          if (containers.length === 0) {
            logger.debug("[FIX] telegram.menu.root.open_containers_disabled", {
              sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
              reason: "no_video_containers",
            });
            await callbackCtx.answerCallbackQuery(telegramCopy.callbackDisabled);
            return;
          }
          store.update(lookup.key, { state: "container", selectedContainer: undefined });
          logger.debug("telegram.menu.root.open_containers", {
            sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
            containerCount: containers.length,
          });
          await callbackCtx.menu.nav(DOWNLOAD_CONTAINER_MENU_ID);
          await callbackCtx.answerCallbackQuery(telegramCopy.callbackAccepted);
          return;
        }
        await callbackCtx.answerCallbackQuery(
          current.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession,
        );
      })
      .row()
      .submenu(telegramButtons.audio, DOWNLOAD_AUDIO_MENU_ID, async (callbackCtx) => {
        const current = store.get(lookup.key);
        if (
          current.status === "found" &&
          (await answerUnauthorizedMenuCallback({
            ctx: callbackCtx,
            session: current.session,
            logger,
            event: "telegram.menu.root.open_audio_unauthorized",
          }))
        ) {
          return;
        }
        if (current.status === "found" && isMenuSessionBusy(current.session)) {
          await callbackCtx.answerCallbackQuery(telegramCopy.running);
          return;
        }
        if (current.status === "found") {
          store.update(lookup.key, { state: "audio", selectedContainer: undefined });
          logger.debug("telegram.menu.root.open_audio", {
            sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
            audioCount: current.session.formatOptions.filter((option) => option.kind === "audio").length,
          });
          await callbackCtx.answerCallbackQuery(telegramCopy.callbackAccepted);
          return;
        }
        logger.warn("telegram.menu.root.open_audio_missing", { status: current.status });
        await callbackCtx.answerCallbackQuery(
          current.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession,
        );
      })
      .row()
      .text(telegramButtons.cancel, async (callbackCtx) => {
        const current = store.get(lookup.key);
        if (current.status !== "found") {
          await callbackCtx.answerCallbackQuery(
            current.status === "expired" ? telegramCopy.expiredSession : telegramCopy.missingSession,
          );
          callbackCtx.menu.close();
          return;
        }
        if (
          await answerUnauthorizedMenuCallback({
            ctx: callbackCtx,
            session: current.session,
            logger,
            event: "telegram.menu.root.cancel_unauthorized",
          })
        ) {
          return;
        }

        logger.debug("telegram.menu.root.cancel", {
          sessionKey: `${lookup.key.chatId}:${lookup.key.messageId}`,
        });
        await onCancel({ ctx: callbackCtx, session: current.session });
        store.delete(lookup.key);
        callbackCtx.menu.close();
        await callbackCtx.answerCallbackQuery(telegramCopy.cancelled);
      });

    return dynamicRange;
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
