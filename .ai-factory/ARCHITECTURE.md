# Architecture: Lightweight Layered Architecture

## Overview

Tuitube should use a lightweight Layered Architecture that keeps the current Termcast extension productive while preparing the codebase for a Telegram video downloader backend. The architecture has one reusable core and multiple outer adapters: the existing Termcast adapter, a future Telegram webhook adapter built with grammY and Fastify, and a later Telegram menu UI adapter built with `@grammyjs/menu`.

The main boundary is not a large domain model. It is the separation between reusable download/transcript/job logic, low-level process and filesystem integrations, transport-specific adapters, and the HTTP server. Core services must stay portable across Termcast, Telegram, CLI tools, and tests.

## Decision Rationale

- **Project type:** Video downloader and transcript extractor with interactive Termcast UI, AI tools, and planned Telegram backend.
- **Tech stack:** TypeScript, Node.js ES modules, React 19, Termcast, planned Fastify webhooks, planned grammY bot runtime.
- **Key factor:** The project needs reusable workflow logic without coupling it to Termcast, grammY, Fastify, Telegram menu plugins, or process-level details.
- **Scale target:** Small single-process backend first, with explicit boundaries for replacing in-memory jobs with Redis/BullMQ later.

## Folder Structure

Target structure:

```text
src/
├── core/
│   ├── services/
│   │   ├── video-download-service.ts # Orchestrates metadata, format policy, temp dirs, and output
│   │   └── transcript-service.ts     # Reusable transcript extraction and cleanup workflow
│   ├── policy/
│   │   └── download-policy.ts        # Pure file size and disk-budget policy rules
│   ├── transcript/
│   │   └── clean-srt.ts              # SRT cleanup helper
│   ├── jobs/
│   │   ├── job-service.ts            # Enqueue, run, track, cancel, and cleanup jobs
│   │   ├── queue.ts                  # Queue interface for in-memory or Redis/BullMQ
│   │   ├── in-memory-queue.ts        # First implementation for small deployments
│   │   ├── download-worker.ts        # Background download runner
│   │   └── temp-job.ts               # Per-job temp directory lifecycle helpers
│   ├── format-selection.ts           # Format grouping, display values, and default choices
│   ├── validation.ts                 # Pure URL/time/live-stream checks
│   ├── sanitize.ts                   # Pure filename/title sanitization
│   ├── logger.ts                     # Backend-safe logger contract
│   ├── types.ts                      # Shared serializable core types
│   └── errors.ts                     # Typed reusable errors and error codes
├── integrations/
│   ├── yt-dlp.ts                     # yt-dlp metadata/download/subtitle commands
│   ├── process.ts                    # Buffered/streaming command execution
│   ├── executables.ts                # Headless executable lookup
│   └── filesystem.ts                 # DOWNLOAD_DIR, temp dirs, cleanup, safe paths
├── adapters/
│   └── telegram/
│       ├── bot.ts                    # grammY bot setup and queue/menu handoff
│       ├── copy.ts                   # Russian Telegram copy and labels
│       ├── menu-session-store.ts     # In-memory menu sessions with TTL
│       ├── metadata-result-dispatcher.ts # Sends prepared menu messages
│       ├── result-sender.ts          # Sends completed media/transcript results
│       └── menus/                    # @grammyjs/menu UI adapter
├── server/
│   ├── config.ts                     # Environment parsing and defaults
│   ├── app.ts                        # Fastify instance and route registration
│   ├── lifecycle.ts                  # Signal shutdown handling
│   └── index.ts                      # Backend process entrypoint
├── tools/                            # Existing Termcast AI tools
├── views/                            # Existing Termcast React views
├── index.tsx                         # Existing Termcast entrypoint until moved
├── transcript.ts                     # Termcast-facing transcript compatibility wrapper
├── utils.ts                          # Termcast-facing preferences/executable compatibility helpers
└── types.ts                          # Re-exports shared core metadata types
```

Migration should be incremental. Existing files may remain at the root while behavior is extracted into `core/`, `integrations/`, and `adapters/termcast/`. New Telegram backend code should start in the target folders instead of adding more transport logic to root modules.

## Layer Responsibilities

### Core Services

Core services contain reusable workflow and policy logic:

- Download orchestration: URL validation result handling, metadata lookup, format option generation, selected format execution, job status, and result contracts.
- Transcript orchestration: subtitle discovery, conversion result handling, transcript cleanup, and typed output.
- Format selection and file size policy as pure functions.
- Job model and queue interface. The first queue can be in-memory, but core code should depend on a queue interface that can later be backed by Redis/BullMQ.
- Typed errors that adapters can map to Termcast toasts, tool errors, or Telegram messages.

Core services must not import Termcast, React, grammY, Fastify, `@grammyjs/menu`, or Telegram Bot API client code.

### Integrations

Integrations contain low-level external details:

- `yt-dlp`, `ffmpeg`, and `ffprobe` process execution.
- Filesystem paths, safe filenames, per-job temp directories, and cleanup.
- Telegram Bot API details that are not part of the grammY adapter, including `TELEGRAM_API_ROOT`.
- Platform-specific executable lookup and external command availability checks.

External commands must be executed with argument arrays, for example `execa(binary, ["--dump-json", url])`. Do not build shell-interpolated command strings from user input.

### Adapters

Adapters translate transport-specific input and output:

- Termcast adapter maps React UI state and AI tool inputs into core service calls, then maps results/errors into Termcast UI, toasts, or serializable tool responses.
- Telegram webhook adapter maps grammY updates into commands, enqueues jobs, and sends immediate acknowledgement messages.
- Telegram menu adapter builds menu state and callbacks with `@grammyjs/menu`, then calls core services through adapter handlers.

Adapters may import core services and integration composition objects. They must not move business policy into UI handlers.

### Server

The server layer owns HTTP process concerns:

- Fastify instance creation.
- Healthcheck and readiness routes.
- Webhook route registration.
- Startup/shutdown hooks.
- Graceful shutdown of job runners and temporary resources.

The server can compose adapters and integrations, but it should not contain download, transcript, format, or Telegram conversation policy.

## Dependency Rules

- Allowed: `adapters/termcast/*` imports `core/*` and maps results to Termcast UI/tool responses.
- Allowed: `adapters/telegram/*` imports `core/*`, grammY, and, in menu-specific files only, `@grammyjs/menu`.
- Allowed: `server/*` imports Fastify, config, health checks, and adapter route registration.
- Allowed: `core/*` depends on TypeScript types, pure helpers, and interfaces for integrations and queues.
- Allowed: `integrations/*` depends on Node APIs, `execa`, filesystem APIs, and external service clients.
- Forbidden: `core/*` imports Termcast, React UI components, grammY, Fastify, or `@grammyjs/menu`.
- Forbidden: webhook handlers perform long-running downloads inside the HTTP request lifecycle.
- Forbidden: adapters bypass `core/policy/download-policy.ts` for file size or format decisions.
- Forbidden: integrations decide user-facing transport behavior such as Telegram message text or Termcast toasts.
- Forbidden: Telegram API root is hardcoded. Use parsed config from `TELEGRAM_API_ROOT`.

## Layer Communication

- Adapters call core service methods with typed commands such as `CreateDownloadJobCommand`.
- Core calls integration interfaces such as `VideoMetadataProvider`, `VideoDownloader`, `TranscriptProvider`, `TempStorage`, and `JobQueue`.
- Integrations return typed data, process results, or typed failures. They do not throw raw CLI output directly across the architecture boundary unless wrapped.
- Core returns typed results and errors. Adapters own the final translation into UI text, HTTP status, Telegram messages, and AI tool result objects.
- Server startup wires concrete integrations into core services once, then passes services to adapters.

## Data Flow: URL -> Metadata -> Format Options -> Job -> Send File -> Cleanup

1. Adapter receives a URL from Termcast, an AI tool, or a Telegram update.
2. Adapter validates transport-level input shape and calls core download service.
3. Core requests metadata through the `yt-dlp` integration.
4. Core builds format options through pure format option and format policy functions.
5. Adapter presents options if the transport supports selection, or core applies a default policy.
6. Adapter creates or confirms a download command and enqueues a job through the job service.
7. Job service allocates a unique temporary directory inside `DOWNLOAD_DIR` for that job.
8. Job runner calls integration functions for `yt-dlp`, `ffmpeg`, `ffprobe`, and filesystem operations.
9. Adapter sends or exposes the finished file through the relevant transport.
10. Cleanup service runs in `finally` so temporary files are removed on success, failure, cancellation, or send failure.

`format-selection.ts` and `policy/download-policy.ts` should stay deterministic and easy to unit test. They should not read environment variables, inspect the filesystem, call external commands, or import UI libraries.

## Webhook Flow

The Telegram webhook route must return quickly:

1. Fastify receives a Telegram update on the webhook route.
2. The route passes the update to the grammY webhook adapter.
3. The adapter parses intent and enqueues work through the job service.
4. The HTTP request completes without waiting for a video download or transcript extraction.
5. A background worker processes the job and reports status through Telegram messages.
6. On completion, the adapter sends the file or failure message through the Telegram Bot API integration.
7. Cleanup runs after the job lifecycle finishes.

Fast operations such as parsing commands, rejecting invalid URLs, and sending an acknowledgement are acceptable in the request lifecycle. Downloading media, probing files, transcoding, and uploading large files are not.

## Job Layer And Queue Boundary

The first backend version may use an in-memory queue because the target server is small and single-process. Keep the boundary explicit:

```ts
export type DownloadJob = {
  id: string;
  url: string;
  chatId?: string;
  selectedFormatId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

export interface JobQueue<TJob> {
  enqueue(job: TJob): Promise<void>;
  next(signal: AbortSignal): Promise<TJob | undefined>;
}
```

Core services should depend on `JobQueue`, not on an array, timer, Redis client, or BullMQ worker directly. The replacement path should be:

```text
core/jobs/queue.ts interface
core/jobs/in-memory-queue.ts first implementation
integrations/redis-queue.ts or integrations/bullmq-queue.ts future implementation
server/index.ts composition switch based on config
```

## Local Telegram Bot API Server Mode

Telegram Bot API access must support both cloud Telegram and a local Bot API server:

- Parse `TELEGRAM_API_ROOT` in `server/config.ts`.
- Pass the value into grammY client configuration or a future Telegram API integration.
- Keep the default compatible with the standard Telegram Bot API.
- Do not hardcode local hostnames, ports, or `/bot<TOKEN>` URL fragments outside parsed configuration and Telegram adapter composition.
- Future file upload/download behavior that differs in local mode should be isolated in a Telegram API integration or adapter module.

Example config shape:

```ts
export type TelegramConfig = {
  botToken: string;
  apiRoot?: string;
  webhookSecret?: string;
};
```

## Small-Server Limits

The initial deployment target is 1 vCPU, 2 GB RAM, and 30 GB disk. Design for predictable resource usage:

- Default job concurrency should be `1` for downloads/transcoding.
- Add a hard cap for queued jobs and reject excess jobs with a transport-specific message.
- Enforce file size policy before expensive work when metadata provides enough information.
- Enforce disk budget under `DOWNLOAD_DIR`; every job must have a separate temp directory.
- Keep logs compact and avoid storing raw large command output unless debugging is explicitly enabled.
- Apply timeouts and cancellation signals to external commands.
- Avoid keeping completed media files longer than needed after send/export.
- Prefer streaming or direct file handles for Telegram upload when supported by the integration.

These constraints belong in core policy/config plus integration cleanup, not in individual UI handlers.

## Telegram Menu UI Layer

The Telegram menu UI should be an adapter concern:

```text
adapters/telegram/
├── menu-session-store.ts   # chat id + message id keyed in-memory sessions
├── metadata-result-dispatcher.ts # background metadata result -> menu message
├── result-sender.ts        # completed media/transcript -> Telegram messages
└── menus/
    ├── download-menu.ts    # @grammyjs/menu root menu definitions
    ├── format-menu.ts      # dynamic format option rendering and callback mapping
    └── menu-state.ts       # adapter-level state projection
```

Rules:

- `@grammyjs/menu` imports are allowed only under `adapters/telegram/menus/` or Telegram adapter composition files.
- Menu callback handlers call core services; they do not implement format policy.
- Core returns stable option IDs and labels that menu code can render.
- This backend-foundation architecture accounts for menus but does not require implementing menu UI yet.

## Key Principles

1. Keep core reusable across Termcast, Telegram, tests, and future adapters.
2. Keep external commands and filesystem mutation in integrations.
3. Keep long-running media jobs outside webhook HTTP request handling.
4. Use a job service boundary from the first Telegram backend version.
5. Treat URLs, filenames, subtitle files, CLI output, and Telegram update payloads as untrusted input.
6. Make cleanup mandatory with `try`/`finally` or a dedicated cleanup service.
7. Prefer small interfaces and incremental migration over a large rewrite.

## Code Examples

### Core Service With Integration Interfaces

```ts
export interface VideoMetadataProvider {
  getMetadata(url: string): Promise<VideoMetadata>;
}

export interface TempStorage {
  createJobDir(jobId: string): Promise<TempJobDirectory>;
  cleanup(path: string): Promise<void>;
}

export class DownloadService {
  constructor(
    private readonly metadataProvider: VideoMetadataProvider,
    private readonly tempStorage: TempStorage,
    private readonly queue: JobQueue<DownloadJob>,
  ) {}

  async createJob(command: CreateDownloadJobCommand): Promise<DownloadJob> {
    const metadata = await this.metadataProvider.getMetadata(command.url);
    const options = buildFormatOptions(metadata);
    const selectedFormatId = selectFormat(options, command.policy);
    const job = createDownloadJob(command.url, selectedFormatId);

    await this.queue.enqueue(job);
    return job;
  }
}
```

### Webhook Handler Enqueues Work

```ts
export async function handleTelegramUpdate(update: TelegramUpdate, services: TelegramAdapterServices): Promise<void> {
  const command = parseDownloadCommand(update);

  if (!command) {
    return;
  }

  const job = await services.downloadService.createJob(command);
  await services.telegramApi.sendMessage(command.chatId, `Queued job ${job.id}`);
}
```

### External Command Integration Uses Argument Arrays

```ts
export async function readMetadata(binary: string, url: string): Promise<VideoMetadata> {
  const result = await execa(binary, ["--dump-json", "--no-playlist", url]);
  return JSON.parse(result.stdout) as VideoMetadata;
}
```

### Mandatory Cleanup

```ts
export async function runDownloadJob(job: DownloadJob, services: JobServices): Promise<void> {
  const tempDir = await services.tempStorage.createJobDir(job.id);

  try {
    await services.downloader.download(job, tempDir.path);
    await services.sender.send(job, tempDir.outputPath);
  } finally {
    await services.tempStorage.cleanup(tempDir.path);
  }
}
```

## Anti-Patterns

- Do not import Termcast, React views, grammY, Fastify, or `@grammyjs/menu` from `core/*`.
- Do not perform downloads, ffmpeg conversions, ffprobe calls, or Telegram file uploads inside Fastify request lifecycle.
- Do not build command strings with user input and shell interpolation.
- Do not share one temp directory across jobs.
- Do not skip cleanup after failed downloads, cancelled jobs, failed uploads, or transcript errors.
- Do not hardcode Telegram API root or local Bot API server URLs.
- Do not put format selection or file size rules inside Termcast components, Telegram command handlers, or menu callbacks.
- Do not let integration modules decide user-facing wording or transport-specific response shapes.
- Do not introduce Redis/BullMQ directly into core services; implement the queue interface.
- Do not implement the future Telegram menu layer during backend-foundation work unless a task explicitly asks for it.
