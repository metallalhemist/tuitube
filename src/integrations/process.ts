import { execa } from "execa";
import { boundedText, TuitubeError } from "../core/errors.js";
import { noopLogger, type Logger } from "../core/logger.js";
import type { ProcessFailure } from "../core/types.js";

export type CommandOptions = {
  executablePath: string;
  args: string[];
  timeoutMs: number;
  maxBufferBytes: number;
  cancelSignal?: AbortSignal;
  env?: Record<string, string | undefined>;
  logger?: Logger;
  phase?: string;
};

export type BufferedCommandResult = {
  stdout: string;
  stderr: string;
};

export type StreamingCommandOptions = CommandOptions & {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

const allowedCommandEnvKeys = new Set([
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "PYTHONUNBUFFERED",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "WINDIR",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

function sanitizeArgs(args: string[]): string[] {
  return args.map((arg) => {
    if (/token|secret|password/i.test(arg)) return "[redacted]";
    if (/^https?:\/\//i.test(arg)) return "[url]";
    if (arg.length > 160) return `${arg.slice(0, 160)}...`;
    return arg;
  });
}

export function buildCommandEnvironment(env: Record<string, string | undefined> | undefined): Record<string, string> {
  const commandEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value !== undefined && allowedCommandEnvKeys.has(key)) {
      commandEnv[key] = value;
    }
  }
  return commandEnv;
}

export function redactCommandOutput(value: string | undefined): string {
  if (!value) return "";

  return value
    .replace(/\bhttps?:\/\/[^\s"'`<>]+/gi, "[url]")
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic|Token)?)\s+[A-Za-z0-9._~+/=-]{10,}/gi, "$1 [redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{10,}/gi, "$1 [redacted]")
    .replace(
      /\b((?!(?:Authorization)\b)[A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|signature|credential|session|jwt|auth)[A-Za-z0-9_.-]*)(\s*[:=]\s*)([^\s,;&"'`]+)/gi,
      "$1$2[redacted]",
    )
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/g, "[redacted-token]");
}

export function mapProcessFailure(error: unknown, executablePath: string): ProcessFailure {
  const value = error as {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    signal?: string;
    timedOut?: boolean;
    isCanceled?: boolean;
    isMaxBuffer?: boolean;
    code?: string;
  };

  return {
    code: value.code ?? "PROCESS_FAILED",
    executablePath,
    exitCode: value.exitCode,
    signal: value.signal,
    timedOut: Boolean(value.timedOut),
    isCanceled: Boolean(value.isCanceled),
    isMaxBuffer: Boolean(value.isMaxBuffer),
    stdoutExcerpt: boundedText(redactCommandOutput(value.stdout)),
    stderrExcerpt: boundedText(redactCommandOutput(value.stderr)),
  };
}

export function processFailureToError(failure: ProcessFailure): TuitubeError {
  const code = failure.isCanceled
    ? "PROCESS_CANCELLED"
    : failure.timedOut
      ? "PROCESS_TIMEOUT"
      : failure.isMaxBuffer
        ? "PROCESS_MAX_BUFFER"
        : "PROCESS_FAILED";

  return new TuitubeError({
    code,
    message: `External command failed: ${code}`,
    details: failure,
  });
}

export async function runBufferedCommand({
  executablePath,
  args,
  timeoutMs,
  maxBufferBytes,
  cancelSignal,
  env,
  logger = noopLogger,
  phase = "command",
}: CommandOptions): Promise<BufferedCommandResult> {
  const commandEnv = buildCommandEnvironment(env);
  logger.debug("process.buffered.start", {
    phase,
    executablePath,
    args: sanitizeArgs(args),
    timeoutMs,
    envKeys: Object.keys(commandEnv).sort(),
  });

  try {
    const result = await execa(executablePath, args, {
      shell: false,
      timeout: timeoutMs,
      cancelSignal,
      maxBuffer: maxBufferBytes,
      windowsHide: true,
      env: commandEnv,
      extendEnv: false,
    });
    logger.debug("process.buffered.finish", {
      phase,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = mapProcessFailure(error, executablePath);
    logger.error("process.buffered.failed", {
      phase,
      code: failure.code,
      exitCode: failure.exitCode,
      timedOut: failure.timedOut,
      isCanceled: failure.isCanceled,
      isMaxBuffer: failure.isMaxBuffer,
      stderrExcerpt: failure.stderrExcerpt,
    });
    throw processFailureToError(failure);
  }
}

export async function runStreamingCommand({
  executablePath,
  args,
  timeoutMs,
  maxBufferBytes,
  cancelSignal,
  env,
  logger = noopLogger,
  phase = "command",
  onStdoutLine,
  onStderrLine,
}: StreamingCommandOptions): Promise<BufferedCommandResult> {
  const commandEnv = buildCommandEnvironment(env);
  logger.debug("process.streaming.start", {
    phase,
    executablePath,
    args: sanitizeArgs(args),
    timeoutMs,
    envKeys: Object.keys(commandEnv).sort(),
  });

  try {
    const subprocess = execa(executablePath, args, {
      shell: false,
      timeout: timeoutMs,
      cancelSignal,
      maxBuffer: maxBufferBytes,
      windowsHide: true,
      env: commandEnv,
      extendEnv: false,
    });

    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";

    subprocess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      const lines = (stdoutRemainder + text).split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) onStdoutLine?.(line);
    });

    subprocess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      const lines = (stderrRemainder + text).split(/\r?\n/);
      stderrRemainder = lines.pop() ?? "";
      for (const line of lines) onStderrLine?.(line);
    });

    await subprocess;
    if (stdoutRemainder) onStdoutLine?.(stdoutRemainder);
    if (stderrRemainder) onStderrLine?.(stderrRemainder);
    logger.debug("process.streaming.finish", { phase, stdoutBytes: stdout.length, stderrBytes: stderr.length });
    return { stdout, stderr };
  } catch (error) {
    const failure = mapProcessFailure(error, executablePath);
    logger.error("process.streaming.failed", {
      phase,
      code: failure.code,
      exitCode: failure.exitCode,
      timedOut: failure.timedOut,
      isCanceled: failure.isCanceled,
      isMaxBuffer: failure.isMaxBuffer,
      stderrExcerpt: failure.stderrExcerpt,
    });
    throw processFailureToError(failure);
  }
}
