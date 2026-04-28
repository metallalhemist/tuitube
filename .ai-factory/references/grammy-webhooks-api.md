# grammY Webhooks and Bot API Reference

> Source: https://grammy.dev/guide/deployment-types.html
> Source: https://grammy.dev/ref/core/webhookcallback
> Source: https://grammy.dev/guide/api
> Source: https://grammy.dev/ref/core/apiclientoptions
> Source: https://grammy.dev/ref/core/webhookoptions
> Source: https://grammy.dev/ref/core/botconfig
> Source: https://grammy.dev/ref/core/api
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

grammY supports two update delivery modes for Telegram bots: long polling and webhooks. Long polling is the default when using `bot.start()`. Webhooks integrate the bot into an HTTP server so Telegram can send updates to a public endpoint.

Use long polling for local development, regular always-on backend servers, and cases where simplicity and explicit throughput control matter. Use webhooks for SSL-backed public servers, serverless platforms, programmable edge networks, and infrastructure that can scale down to zero.

The same middleware tree works in both modes. Switching between modes usually affects startup and deployment code, not handler logic.

## Core Concepts

Long polling: The bot asks Telegram for updates. If no updates are available, Telegram keeps the connection open for a while. grammY uses long polling by default when `bot.start()` is called.

Webhooks: Telegram sends each update to a public HTTPS endpoint. grammY converts a bot into framework middleware with `webhookCallback`.

Webhook adapter: The second argument to `webhookCallback` identifies the web framework or runtime interface. The adapter translates framework request/response objects into grammY update processing.

Webhook reply: A webhook bot may send up to one API call in the HTTP response to Telegram. This can save an HTTP request, but the bot cannot observe the result, handle API errors, or cancel the request.

Bot API client: `bot.api` is a prebuilt `Api` instance. `ctx.api` exposes the same client inside handlers and is preferred when a context object is available.

Raw API: `bot.api.raw` and `ctx.api.raw` use Telegram's original object-style payload signatures while retaining grammY's serialization support.

Local Bot API server: grammY can use a custom Bot API server through `client.apiRoot`. This is mainly useful for larger file handling or reducing latency, and the official docs say it should run on a VPS.

## API / Interface

### `webhookCallback`

Purpose: create a framework callback or middleware for a bot running via webhooks.

```ts
webhookCallback<
  C extends Context = Context,
  A extends FrameworkAdapter | AdapterNames =
    FrameworkAdapter | AdapterNames,
>(
  bot: Bot<C>,
  adapter: A,
  webhookOptions?: WebhookOptions,
): (...args: Parameters<ResolveName<A>>) =>
  ReturnType<ResolveName<A>>["handlerReturn"] extends undefined
    ? Promise<void>
    : NonNullable<ReturnType<ResolveName<A>>["handlerReturn"]>;
```

```ts
webhookCallback<
  C extends Context = Context,
  A extends FrameworkAdapter | AdapterNames =
    FrameworkAdapter | AdapterNames,
>(
  bot: Bot<C>,
  adapter: A,
  onTimeout?: WebhookOptions["onTimeout"],
  timeoutMilliseconds?: WebhookOptions["timeoutMilliseconds"],
  secretToken?: WebhookOptions["secretToken"],
): (...args: Parameters<ResolveName<A>>) =>
  ReturnType<ResolveName<A>>["handlerReturn"] extends undefined
    ? Promise<void>
    : NonNullable<ReturnType<ResolveName<A>>["handlerReturn"]>;
```

### `WebhookOptions`

```ts
interface WebhookOptions {
  onTimeout?: "throw" | "return" | ((...args: any[]) => unknown);
  timeoutMilliseconds?: number;
  secretToken?: string;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `onTimeout` | `"throw"` | Strategy when middleware exceeds the webhook timeout. |
| `timeoutMilliseconds` | `10_000` | grammY's webhook callback timeout. |
| `secretToken` | None | Compared to the `X-Telegram-Bot-Api-Secret-Token` request header. |

### `BotConfig`

```ts
interface BotConfig<C extends Context = Context> {
  client?: ApiClientOptions;
  botInfo?: UserFromGetMe;
  ContextConstructor?: new (...args: ConstructorParameters<typeof Context>) => C;
}
```

`client` passes advanced HTTP client options to the underlying Bot API client. `botInfo` can avoid an initial `getMe` call when cached bot information is supplied, which is useful in serverless deployments that restart often.

### `ApiClientOptions`

```ts
interface ApiClientOptions {
  apiRoot?: string;
  environment?: "prod" | "test";
  buildUrl?: (
    root: string,
    token: string,
    method: string,
    env: "prod" | "test",
  ) => string | URL;
  timeoutSeconds?: number;
  canUseWebhookReply?: (method: string) => boolean;
  baseFetchConfig?: Omit<
    NonNullable<Parameters<typeof fetch>[1]>,
    "method" | "headers" | "body"
  >;
  fetch?: typeof fetch;
  sensitiveLogs?: boolean;
}
```

### `Api`

```ts
new Api(
  token: string,
  options?: ApiClientOptions,
  webhookReplyEnvelope?: WebhookReplyEnvelope,
);
```

Relevant properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `raw` | `R` | Raw Telegram Bot API methods with original object-style payloads. |
| `config` | `{ use; installedTransformers }` | API transformer namespace for advanced request modification. |
| `token` | `string` | Bot token from BotFather. |
| `options` | `ApiClientOptions | undefined` | Client options for the underlying Bot API client. |

Relevant methods:

```ts
getUpdates(other?: Other<R, "getUpdates">, signal?: AbortSignal);
setWebhook(
  url: string,
  other?: Other<R, "setWebhook", "url">,
  signal?: AbortSignal,
);
deleteWebhook(other?: Other<R, "deleteWebhook">, signal?: AbortSignal);
getWebhookInfo(signal?: AbortSignal);
getMe(signal?: AbortSignal);
logOut(signal?: AbortSignal);
close(signal?: AbortSignal);
sendMessage(
  chat_id: number | string,
  text: string,
  other?: Other<R, "sendMessage", "chat_id" | "text">,
  signal?: AbortSignal,
);
```

Important method behavior:

| Method | Notes |
| --- | --- |
| `getUpdates` | Used for long polling. Does not work while an outgoing webhook is set. |
| `setWebhook` | Configures the webhook URL. Telegram sends HTTPS POST updates to that URL. Supports `secret_token` in the `other` argument. |
| `deleteWebhook` | Removes webhook integration when switching back to `getUpdates`. |
| `getWebhookInfo` | Returns current webhook status. If using `getUpdates`, the URL field is empty. |
| `logOut` | Required before launching a bot against a local Bot API server. |
| `close` | Used before moving a local-server bot instance. The docs say to delete the webhook before calling it. |

## Usage Patterns

### Long polling startup

```ts
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", (ctx) => ctx.reply("Ready"));

await bot.start();
```

### Express webhook startup

```ts
import express from "express";
import { Bot, webhookCallback } from "grammy";

const token = process.env.BOT_TOKEN!;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET!;

const bot = new Bot(token);
const app = express();

bot.command("start", (ctx) => ctx.reply("Ready"));

app.use(express.json());
app.use(
  "/webhook",
  webhookCallback(bot, "express", {
    secretToken: webhookSecret,
  }),
);

await bot.api.setWebhook("https://example.com/webhook", {
  secret_token: webhookSecret,
});
```

Do not call `bot.start()` in webhook mode.

### Webhook reply for a narrow method

```ts
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!, {
  client: {
    canUseWebhookReply: (method) => method === "sendChatAction",
  },
});
```

Use this only for calls where losing the response and error surface is acceptable.

### Regular and raw API calls

```ts
await bot.api.sendMessage(chatId, "Ready", { parse_mode: "HTML" });

await bot.api.raw.sendMessage({
  chat_id: chatId,
  text: "Ready",
  parse_mode: "HTML",
});
```

Inside handlers, prefer `ctx.api` or context actions when available.

### Local Bot API server

```ts
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!, {
  client: { apiRoot: "http://localhost:8081" },
});
```

Before moving from Telegram's hosted Bot API server to a local server, log out from the hosted server:

```text
https://api.telegram.org/bot<token>/logOut
```

After switching to a local Bot API server, file paths can become local paths rather than URLs.

## Configuration

### Deployment Mode Choice

| Use case | Prefer | Reason |
| --- | --- | --- |
| Local development | Long polling | No public URL, domain, or TLS setup needed. |
| Always-on backend server | Long polling | Simple deployment and explicit processing control. |
| Serverless or scale-to-zero platform | Webhooks | No need to keep polling connections open. |
| Edge or frontend-style hosting | Webhooks | Platform usually expects request-triggered code. |
| Long-running per-update work | Neither directly | Keep webhook middleware short and move work to a queue. |

### Webhook Adapters

| Adapter | Known target |
| --- | --- |
| `aws-lambda` | AWS Lambda Functions |
| `aws-lambda-async` | AWS Lambda Functions with `async`/`await` |
| `azure` | Azure Functions |
| `bun` | `Bun.serve` |
| `cloudflare` | Cloudflare Workers |
| `cloudflare-mod` | Cloudflare Module Workers |
| `express` | Express, Google Cloud Functions |
| `fastify` | Fastify |
| `hono` | Hono |
| `http`, `https` | Node.js `http`/`https` modules, Vercel Serverless |
| `koa` | Koa |
| `next-js` | Next.js |
| `nhttp` | NHttp |
| `oak` | Oak |
| `serveHttp` | `Deno.serveHttp` |
| `std/http` | `Deno.serve`, `std/http`, `Deno.upgradeHttp`, Fresh, Ultra, Rutt, Sift, Vercel Edge Runtime |
| `sveltekit` | SvelteKit |
| `worktop` | Worktop |

### ApiClientOptions Defaults

| Option | Default | Notes |
| --- | --- | --- |
| `apiRoot` | `https://api.telegram.org` | Set to a local/custom Bot API server root when needed. |
| `environment` | `"prod"` | `"test"` uses Telegram's separate test infrastructure. |
| `buildUrl` | Built in | Override to modify the API URL construction. |
| `timeoutSeconds` | `500` | Higher than default only makes sense with a custom Bot API server. |
| `canUseWebhookReply` | Not enabled | Function decides whether a method may use webhook reply. |
| `baseFetchConfig` | `{ compress: true }` on Node, `{}` on Deno | Extra fetch config excluding method, headers, and body. |
| `fetch` | `node-fetch` on Node, built-in `fetch` on Deno | Override the fetch implementation. |
| `sensitiveLogs` | `false` | `true` can expose token-containing URLs in logs. |

### Type Imports on Node.js

Use:

```ts
import { type Chat } from "grammy/types";
```

The docs warn against importing from `grammy/out`. For proper Node.js subpath imports, TypeScript may need `moduleResolution` set to `node16` or `nodenext`.

## Best Practices

1. Start with long polling unless the deployment platform or cost model points strongly to webhooks.
2. In webhook mode, never call `bot.start()`; connect the bot through `webhookCallback`.
3. Set the webhook from code with `bot.api.setWebhook(endpoint, options)` or through Telegram's `setWebhook` endpoint.
4. Pair `setWebhook(..., { secret_token })` with `webhookCallback(..., { secretToken })` so incoming webhook requests can be checked.
5. Keep webhook middleware fast. Put slow file transfers, AI calls, and other long tasks into a separate queue, then respond to the chat when the job finishes.
6. Keep `onTimeout` at the default `"throw"` unless there is a specific, tested reason to use `"return"` or a custom function.
7. Use webhook replies only for low-risk calls such as typing indicators, where missing the API response and error handling is acceptable.
8. Use `ctx.api` or context actions inside handlers. Use `bot.api` from code that is outside update handling.
9. Use `bot.api.raw` only when the original Bot API payload shape is needed.
10. Keep `sensitiveLogs` false unless logs are guaranteed not to leave trusted storage.

## Common Pitfalls

Calling `bot.start()` with webhooks: This mixes deployment modes. Webhook deployments should expose a framework callback and set the webhook URL.

Leaving a webhook configured while trying long polling: `getUpdates` does not work while an outgoing webhook is set. Use `deleteWebhook` when switching back.

Slow webhook handlers: Telegram waits for the webhook request to finish before sending the next update for the same chat. If the request times out, Telegram retries, which can duplicate processing.

Using `"return"` as a timeout workaround: Ending the request early while middleware keeps running can allow later updates from the same chat to run concurrently with older work. That can create race conditions and can break session-like state.

Overusing webhook reply: Webhook reply hides API errors and results, ignores cancellation, and grammY's return types still look like ordinary API calls.

Custom Bot API server without `logOut`: The docs require logging out from the hosted Bot API server before launching locally.

Local Bot API file handling: After switching to a local Bot API server, `getFile` and related file helpers may return local file paths instead of downloadable URLs.

## Version Notes

The fetched pages did not expose a single package version banner. The Bot API guide's Deno example used `grammy@v1.42.0`. Treat this reference as a documentation snapshot from 2026-04-27 and refresh it before relying on exact adapter support or type signatures in a future package upgrade.
