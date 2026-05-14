import { noopLogger, type Logger } from "../../core/logger.js";
import type { SerializableFormatOption } from "../../core/types.js";

export const TELEGRAM_MENU_SESSION_TTL_MS = 15 * 60 * 1000;

export type TelegramMenuSessionKey = {
  chatId: string;
  messageId: number;
};

export type TelegramSelectableMenuState = "root" | "container" | "quality" | "audio";
export type TelegramMenuState = TelegramSelectableMenuState | "starting" | "progress" | "sending" | "closed";

export type TelegramMenuSession = TelegramMenuSessionKey & {
  url: string;
  requesterUserId?: string;
  title: string;
  duration: number;
  formatOptions: SerializableFormatOption[];
  createdAt: number;
  expiresAt: number;
  state: TelegramMenuState;
  selectedContainer?: string;
  activeJobId?: string;
  expectedSizeBytes?: number;
  returnState?: TelegramSelectableMenuState;
  returnSelectedContainer?: string;
};

export type TelegramMenuSessionLookup =
  | { status: "found"; session: TelegramMenuSession }
  | { status: "missing"; key: TelegramMenuSessionKey }
  | { status: "expired"; key: TelegramMenuSessionKey };

export type TelegramMenuStartResult =
  | {
      status: "started";
      key: TelegramMenuSessionKey;
      session: TelegramMenuSession;
      previousState: TelegramSelectableMenuState;
      previousSelectedContainer?: string;
    }
  | { status: "busy"; key: TelegramMenuSessionKey; session: TelegramMenuSession }
  | { status: "missing" | "expired"; key: TelegramMenuSessionKey };

export type CreateTelegramMenuSessionInput = TelegramMenuSessionKey & {
  url: string;
  requesterUserId?: string;
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

export function isTelegramMenuProgressSession(session: TelegramMenuSession): boolean {
  return (
    Boolean(session.activeJobId) &&
    (session.state === "starting" || session.state === "progress" || session.state === "sending")
  );
}

function isSelectableMenuState(state: TelegramMenuState): state is TelegramSelectableMenuState {
  return state === "root" || state === "container" || state === "quality" || state === "audio";
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
      requesterUserId: input.requesterUserId,
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
      hasRequesterUserId: Boolean(session.requesterUserId),
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

    if (session.expiresAt <= now && !isTelegramMenuProgressSession(session)) {
      this.sessions.delete(storeKey);
      this.logger.debug("telegram.menu_session.expired", { chatId: key.chatId, messageId: key.messageId });
      return { status: "expired", key };
    }

    this.logger.debug("telegram.menu_session.get", { chatId: key.chatId, messageId: key.messageId });
    return { status: "found", session };
  }

  update(
    key: TelegramMenuSessionKey,
    patch: Partial<
      Pick<
        TelegramMenuSession,
        | "state"
        | "selectedContainer"
        | "activeJobId"
        | "expectedSizeBytes"
        | "expiresAt"
        | "returnState"
        | "returnSelectedContainer"
      >
    >,
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
      hasExpectedSizeBytes: typeof updated.expectedSizeBytes === "number",
      returnState: updated.returnState,
      returnSelectedContainer: updated.returnSelectedContainer,
    });
    return { status: "found", session: updated };
  }

  tryMarkStarting(
    key: TelegramMenuSessionKey,
    patch: Pick<Partial<TelegramMenuSession>, "expectedSizeBytes"> = {},
    now = this.now(),
  ): TelegramMenuStartResult {
    const lookup = this.get(key, now);
    if (lookup.status !== "found") return { status: lookup.status, key };

    if (lookup.session.state === "starting" || lookup.session.state === "progress" || lookup.session.activeJobId) {
      this.logger.info("telegram.menu_session.starting_busy", {
        chatId: key.chatId,
        messageId: key.messageId,
        activeJobId: lookup.session.activeJobId,
      });
      return { status: "busy", key, session: lookup.session };
    }

    const previousState = isSelectableMenuState(lookup.session.state) ? lookup.session.state : "root";
    const previousSelectedContainer = lookup.session.selectedContainer;
    const updated = {
      ...lookup.session,
      state: "starting" as const,
      expectedSizeBytes: patch.expectedSizeBytes,
      returnState: previousState,
      returnSelectedContainer: previousSelectedContainer,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(createTelegramMenuSessionKey(key), updated);
    this.logger.debug("telegram.menu_session.starting", {
      chatId: key.chatId,
      messageId: key.messageId,
      hasExpectedSizeBytes: typeof patch.expectedSizeBytes === "number",
      returnState: previousState,
      returnSelectedContainer: previousSelectedContainer,
    });
    return { status: "started", key, session: updated, previousState, previousSelectedContainer };
  }

  markProgress(
    key: TelegramMenuSessionKey,
    input: { activeJobId: string; expectedSizeBytes?: number },
    now = this.now(),
  ): TelegramMenuSessionLookup {
    return this.update(
      key,
      {
        state: "progress",
        activeJobId: input.activeJobId,
        expectedSizeBytes: input.expectedSizeBytes,
        expiresAt: now + this.ttlMs,
      },
      now,
    );
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
      if (session.expiresAt <= now && !isTelegramMenuProgressSession(session)) {
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
