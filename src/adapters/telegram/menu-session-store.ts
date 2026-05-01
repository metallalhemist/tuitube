import { noopLogger, type Logger } from "../../core/logger.js";
import type { SerializableFormatOption } from "../../core/types.js";

export const TELEGRAM_MENU_SESSION_TTL_MS = 15 * 60 * 1000;

export type TelegramMenuSessionKey = {
  chatId: string;
  messageId: number;
};

export type TelegramMenuState = "root" | "container" | "quality" | "closed";

export type TelegramMenuSession = TelegramMenuSessionKey & {
  url: string;
  title: string;
  duration: number;
  formatOptions: SerializableFormatOption[];
  createdAt: number;
  expiresAt: number;
  state: TelegramMenuState;
  selectedContainer?: string;
  activeJobId?: string;
};

export type TelegramMenuSessionLookup =
  | { status: "found"; session: TelegramMenuSession }
  | { status: "missing"; key: TelegramMenuSessionKey }
  | { status: "expired"; key: TelegramMenuSessionKey };

export type CreateTelegramMenuSessionInput = TelegramMenuSessionKey & {
  url: string;
  title: string;
  duration: number;
  formatOptions: SerializableFormatOption[];
  now?: number;
};

export type TelegramCallbackMessage = {
  message_id: number;
  chat: {
    id: number | string;
  };
};

export function createTelegramMenuSessionKey({ chatId, messageId }: TelegramMenuSessionKey): string {
  return `${chatId}:${messageId}`;
}

export function telegramMenuSessionKeyFromMessage(
  message: TelegramCallbackMessage | undefined,
): TelegramMenuSessionKey | undefined {
  if (!message) return undefined;
  return {
    chatId: String(message.chat.id),
    messageId: message.message_id,
  };
}

export class TelegramMenuSessionStore {
  private readonly sessions = new Map<string, TelegramMenuSession>();
  private readonly ttlMs: number;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor({
    ttlMs = TELEGRAM_MENU_SESSION_TTL_MS,
    logger = noopLogger,
    now = () => Date.now(),
  }: {
    ttlMs?: number;
    logger?: Logger;
    now?: () => number;
  } = {}) {
    this.ttlMs = ttlMs;
    this.logger = logger;
    this.now = now;
  }

  create(input: CreateTelegramMenuSessionInput): TelegramMenuSession {
    const createdAt = input.now ?? this.now();
    const session: TelegramMenuSession = {
      chatId: input.chatId,
      messageId: input.messageId,
      url: input.url,
      title: input.title,
      duration: input.duration,
      formatOptions: input.formatOptions,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      state: "root",
    };

    this.sessions.set(createTelegramMenuSessionKey(session), session);
    this.logger.debug("telegram.menu_session.create", {
      chatId: session.chatId,
      messageId: session.messageId,
      expiresAt: session.expiresAt,
      formatCount: session.formatOptions.length,
    });
    return session;
  }

  get(key: TelegramMenuSessionKey, now = this.now()): TelegramMenuSessionLookup {
    const storeKey = createTelegramMenuSessionKey(key);
    const session = this.sessions.get(storeKey);
    if (!session) {
      this.logger.warn("telegram.menu_session.missing", { chatId: key.chatId, messageId: key.messageId });
      return { status: "missing", key };
    }

    if (session.expiresAt <= now) {
      this.sessions.delete(storeKey);
      this.logger.debug("telegram.menu_session.expired", { chatId: key.chatId, messageId: key.messageId });
      return { status: "expired", key };
    }

    this.logger.debug("telegram.menu_session.get", { chatId: key.chatId, messageId: key.messageId });
    return { status: "found", session };
  }

  update(
    key: TelegramMenuSessionKey,
    patch: Partial<Pick<TelegramMenuSession, "state" | "selectedContainer" | "activeJobId">>,
    now = this.now(),
  ): TelegramMenuSessionLookup {
    const lookup = this.get(key, now);
    if (lookup.status !== "found") return lookup;

    const updated = {
      ...lookup.session,
      ...patch,
    };
    this.sessions.set(createTelegramMenuSessionKey(key), updated);
    this.logger.debug("telegram.menu_session.update", {
      chatId: key.chatId,
      messageId: key.messageId,
      state: updated.state,
      selectedContainer: updated.selectedContainer,
      hasActiveJob: Boolean(updated.activeJobId),
    });
    return { status: "found", session: updated };
  }

  delete(key: TelegramMenuSessionKey): boolean {
    const deleted = this.sessions.delete(createTelegramMenuSessionKey(key));
    this.logger.debug("telegram.menu_session.delete", {
      chatId: key.chatId,
      messageId: key.messageId,
      deleted,
    });
    return deleted;
  }

  pruneExpired(now = this.now()): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(createTelegramMenuSessionKey(session));
        count += 1;
        this.logger.debug("telegram.menu_session.prune_expired", {
          chatId: session.chatId,
          messageId: session.messageId,
        });
      }
    }
    return count;
  }

  size(): number {
    return this.sessions.size;
  }
}
