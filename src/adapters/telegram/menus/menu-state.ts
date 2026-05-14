import type { InlineKeyboardButton } from "grammy/types";
import type { Logger } from "../../../core/logger.js";
import { telegramCopy } from "../copy.js";
import type { TelegramMenuContext } from "../context.js";
import {
  telegramMenuSessionKeyFromMessage,
  type TelegramCallbackMessage,
  type TelegramMenuSession,
  type TelegramMenuSessionKey,
  type TelegramMenuSessionLookup,
  type TelegramMenuSessionStore,
} from "../menu-session-store.js";

export const DOWNLOAD_ROOT_MENU_ID = "tuitube-download-root";
export const DOWNLOAD_CONTAINER_MENU_ID = "tuitube-download-container";
export const DOWNLOAD_QUALITY_MENU_ID = "tuitube-download-quality";
export const DOWNLOAD_AUDIO_MENU_ID = "tuitube-download-audio";

export type MenuLookupResult =
  | { status: "found"; session: TelegramMenuSession; key: TelegramMenuSessionKey }
  | { status: "missing" | "expired"; key?: TelegramMenuSessionKey };

export function getMenuSessionLookup(ctx: TelegramMenuContext, store: TelegramMenuSessionStore): MenuLookupResult {
  const key = telegramMenuSessionKeyFromMessage(ctx.callbackQuery?.message as TelegramCallbackMessage | undefined);
  if (!key) return { status: "missing" };

  const lookup: TelegramMenuSessionLookup = store.get(key);
  if (lookup.status === "found") return { status: "found", session: lookup.session, key };
  return { status: lookup.status, key };
}

export function menuFingerprint(session: TelegramMenuSession): string {
  return [
    session.chatId,
    session.messageId,
    session.expiresAt,
    session.state,
    session.selectedContainer ?? "",
    session.formatOptions.length,
    session.activeJobId ?? "",
    session.expectedSizeBytes ?? "",
    session.requesterUserId ?? "",
    session.returnState ?? "",
    session.returnSelectedContainer ?? "",
  ].join(":");
}

export function isMenuSessionBusy(session: TelegramMenuSession): boolean {
  return (
    session.state === "starting" ||
    session.state === "progress" ||
    session.state === "sending" ||
    Boolean(session.activeJobId)
  );
}

export async function renderMenuMarkup<C extends TelegramMenuContext>(
  menu: unknown,
  ctx: C,
): Promise<{ inline_keyboard: InlineKeyboardButton[][] }> {
  const renderable = menu as { render(context: C): Promise<InlineKeyboardButton[][]> };
  return {
    inline_keyboard: await renderable.render(ctx),
  };
}

export function createSyntheticMenuContext(chatId: string, messageId: number): TelegramMenuContext {
  return {
    callbackQuery: {
      message: {
        message_id: messageId,
        chat: { id: chatId },
      },
    },
  } as unknown as TelegramMenuContext;
}

type TelegramCallbackMessageWithChatType = {
  chat?: {
    type?: string;
  };
};

export function isMenuSessionAuthorizedForCallback(ctx: TelegramMenuContext, session: TelegramMenuSession): boolean {
  const callbackUserId = ctx.from?.id === undefined ? undefined : String(ctx.from.id);
  if (session.requesterUserId) return callbackUserId === session.requesterUserId;

  const message = ctx.callbackQuery?.message as TelegramCallbackMessageWithChatType | undefined;
  return message?.chat?.type === "private";
}

export async function answerUnauthorizedMenuCallback({
  ctx,
  session,
  logger,
  event,
}: {
  ctx: TelegramMenuContext;
  session: TelegramMenuSession;
  logger: Logger;
  event: string;
}): Promise<boolean> {
  if (isMenuSessionAuthorizedForCallback(ctx, session)) return false;

  const message = ctx.callbackQuery?.message as TelegramCallbackMessageWithChatType | undefined;
  logger.warn(event, {
    chatId: session.chatId,
    messageId: session.messageId,
    hasRequesterUserId: Boolean(session.requesterUserId),
    hasCallbackUserId: ctx.from?.id !== undefined,
    chatType: message?.chat?.type,
  });
  await ctx.answerCallbackQuery(telegramCopy.unauthorizedCallback);
  return true;
}
