import type { InlineKeyboardButton } from "grammy/types";
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
  ].join(":");
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

export function createSyntheticMenuContext(
  chatId: string,
  messageId: number,
): TelegramMenuContext {
  return {
    callbackQuery: {
      message: {
        message_id: messageId,
        chat: { id: chatId },
      },
    },
  } as unknown as TelegramMenuContext;
}
