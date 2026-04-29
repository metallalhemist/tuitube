import { describe, expect, it, vi } from "vitest";
import { TuitubeError } from "../../core/errors.js";
import type { JobService } from "../../core/jobs/job-service.js";
import { handleTelegramTextMessage } from "./bot.js";

function createContext(text: string) {
  return {
    message: { text },
    chat: { id: 123 },
    reply: vi.fn(async () => undefined),
  };
}

describe("telegram bot adapter", () => {
  it("replies immediately when the download queue is full", async () => {
    const ctx = createContext("https://example.com/video");
    const jobService = {
      createMediaJob: vi.fn(async () => {
        throw new TuitubeError({
          code: "QUEUE_FULL",
          message: "Job queue is full",
          severity: "warn",
        });
      }),
    } as unknown as JobService;

    await handleTelegramTextMessage(ctx as never, jobService);

    expect(ctx.reply).toHaveBeenCalledWith("Проверяю ссылку и готовлю варианты...");
    expect(ctx.reply).toHaveBeenCalledWith("Очередь сейчас заполнена. Попробуйте позже.");
  });

  it("replies immediately when enqueueing fails unexpectedly", async () => {
    const ctx = createContext("https://example.com/video");
    const jobService = {
      createMediaJob: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    } as unknown as JobService;

    await handleTelegramTextMessage(ctx as never, jobService);

    expect(ctx.reply).toHaveBeenCalledWith("Проверяю ссылку и готовлю варианты...");
    expect(ctx.reply).toHaveBeenCalledWith("Не удалось подготовить варианты для этой ссылки. Попробуйте другую ссылку позже.");
  });

  it("rejects invalid URLs in Russian without enqueueing work", async () => {
    const ctx = createContext("not a url");
    const jobService = {
      createMediaJob: vi.fn(),
    } as unknown as JobService;

    await handleTelegramTextMessage(ctx as never, jobService);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Не похоже на поддерживаемую ссылку. Пришлите полный URL, начинающийся с http:// или https://.",
    );
    expect(jobService.createMediaJob).not.toHaveBeenCalled();
  });
});
