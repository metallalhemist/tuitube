export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error" || value === "silent") {
    return value;
  }
  return fallback;
}

export function createConsoleLogger(level: LogLevel = "info"): Logger {
  const shouldLog = (target: Exclude<LogLevel, "silent">) => levelPriority[target] >= levelPriority[level];
  const emit = (target: Exclude<LogLevel, "silent">, message: string, context: LogContext = {}) => {
    if (!shouldLog(target)) return;
    const payload = {
      level: target,
      message,
      ...context,
    };
    const line = JSON.stringify(payload);
    if (target === "error") {
      console.error(line);
      return;
    }
    if (target === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    debug(message, context) {
      emit("debug", message, context);
    },
    info(message, context) {
      emit("info", message, context);
    },
    warn(message, context) {
      emit("warn", message, context);
    },
    error(message, context) {
      emit("error", message, context);
    },
  };
}
