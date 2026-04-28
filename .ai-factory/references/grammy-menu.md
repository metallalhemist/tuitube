# grammY Menu Reference

> Source:
> - https://grammy.dev/plugins/menu
> - https://grammy.dev/ref/menu/menu
> - https://grammy.dev/ref/menu/menuoptions
> - https://grammy.dev/ref/menu/menuflavor
> - https://grammy.dev/ref/menu/menurange
> - https://grammy.dev/ref/menu/menucontrolpanel
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

The grammY `menu` plugin builds interactive inline-keyboard menus. A menu can contain text buttons with handlers, URL and Telegram-specific buttons, dynamic labels, dynamic button ranges, payloads, and navigation across multiple menu pages.

Menus are stateless at rest. The plugin records how to render a menu, renders it when a message is sent, and renders enough of it again when a callback query arrives so it can identify the pressed button and handler. This makes menu definitions important: create and register menus before the bot starts handling updates, then use dynamic labels or dynamic ranges for runtime changes.

For Node TypeScript, examples import `Menu` and `MenuRange` from `@grammyjs/menu`. The main guide also shows Deno imports from `grammy_menu`.

## Core Concepts

`Menu`: A menu instance with an identifier. It extends `MenuRange<C>` and can be installed as middleware with `bot.use(menu)`.

`MenuRange`: A reusable two-dimensional button range. It exposes the same button-building methods as a menu but has no identifier and cannot be registered as a navigation target.

`ctx.menu`: A `MenuControlPanel` available only inside menu handlers. Use it to update, close, or navigate the active menu.

`ctx.match`: Optional payload string made available to handlers for buttons created from a text/payload object.

Dynamic string: A button label or option value computed from the current context. Use it for labels such as toggles or per-user text.

Dynamic range: A function that generates part or all of a menu layout during rendering. Use it when the number or structure of buttons depends on session data or another data source.

Outdated menu: A menu instance in chat history whose rendered shape or button metadata no longer matches the current menu definition. By default, the plugin avoids running stale handlers and replaces the menu.

## API / Interface

### Menu

```ts
class Menu<C extends Context = Context> extends MenuRange<C>
  implements MiddlewareObj<C>, InlineKeyboardMarkup
```

Constructor from the API reference:

```ts
Menu(id: string, options: MenuOptions<C>);
```

The guide examples use `new Menu("id")` when default options are enough.

Properties:

| Property | Type | Notes |
| --- | --- | --- |
| `parent` | `string | undefined` | Parent menu id used by backwards navigation. |
| `index` | `Map<string, Menu<C>>` | Shared menu registry for a menu hierarchy. |
| `options` | `Required<MenuOptions<C> & { onMenuOutdated: string | false | MenuMiddleware<C> }>` | Normalized options. |
| `inline_keyboard` | `Proxy` | Internal rendering bridge. Do not use directly. |
| `id` | `string` | Menu identifier passed to the constructor. |

Methods:

| Method | Signature | Purpose |
| --- | --- | --- |
| `register` | `register(menus: Menu<C> | Menu<C>[], parent): void` | Registers submenus and optionally overrides their parent target. |
| `freeze` | `freeze(): void` | Prevents later modification. |
| `at` | `at(id: string)` | Returns a menu instance by id from this menu's index. |
| `render` | `render(ctx: C)` | Produces static inline-keyboard markup from ranges and context. |
| `prepare` | `prepare(payload: Record<string, unknown>, ctx: C): Promise<void>` | Replaces known menu instances in `reply_markup` payloads with rendered markup. |
| `middleware` | `middleware()` | Middleware entry point. |
| `makeNavInstaller` | `makeNavInstaller<C extends Context>(menu: Menu<C>): Middleware<C>` | Internal navigation middleware helper. |

### MenuOptions

| Option | Type | Default / Behavior |
| --- | --- | --- |
| `autoAnswer` | `boolean` | Enabled by default. Set `false` if handlers will call `ctx.answerCallbackQuery` themselves. |
| `onMenuOutdated` | `string | boolean | MenuMiddleware<C>` | Default behavior shows an outdated-menu notice and updates the menu. A string customizes the notice, middleware handles the case manually, and `false` disables outdated checks. |
| `fingerprint` | `(ctx: C) => MaybePromise<string>` | Replaces the built-in outdated-menu heuristic with a custom state identifier. |

### MenuFlavor

```ts
type MenuFlavor = {
  match?: string;
  menu: MenuControlPanel;
};
```

Use this flavor in context types for handlers that access `ctx.menu` or payloads via `ctx.match`.

### MenuControlPanel

| Method | Signature in API page | Typical use |
| --- | --- | --- |
| `update` | `update(config: { immediate: true }): Promise<void>` | Re-render the current menu. Call without config for lazy update; pass `{ immediate: true }` to update eagerly and await it. |
| `close` | `close(config: { immediate: true }): Promise<void>` | Remove the menu buttons. Lazy by default; immediate mode returns a promise. |
| `back` | `back(config: { immediate: true }): Promise<void>` | Navigate to the parent menu. Throws if there is no parent. |
| `nav` | `nav(to: string, config: { immediate: true }): Promise<void>` | Navigate to a registered submenu id. Passing the current menu id behaves like an update. |

### MenuRange

Layout and styling:

| Method | Signature | Purpose |
| --- | --- | --- |
| `row` | `row()` | Starts a new row for subsequent buttons. |
| `style` | `style(style: MaybeDynamic<C, NonNullable<ButtonOptions["style"]>>)` | Applies a style to the last static button. |
| `danger` | `danger()` | Alias for danger style. |
| `success` | `success()` | Alias for success style. |
| `primary` | `primary()` | Alias for primary style. |
| `icon` | `icon(icon: MaybeDynamic<C, string>)` | Adds a custom emoji icon to the last static button. |
| `append` | `append(range: MaybeRawRange<C>)` | Replays another range into this one. |

Button methods:

```ts
url(text: MaybeDynamic<C, string> | TextWithOptions<C>, url: MaybeDynamic<C, string>);

text(text: MaybeDynamic<C, string>, ...middleware: MenuMiddleware<C>[]): this;
text(text: TextWithPayload<C>, ...middleware: MenuMiddleware<C & { match: string }>[]): this;
text(text: MaybeDynamic<C, string> | TextWithPayload<C>, ...middleware: MenuMiddleware<C>[]): this;

webApp(text: MaybeDynamic<C, string> | TextWithOptions<C>, url: string);
login(text: MaybeDynamic<C, string> | TextWithOptions<C>, loginUrl: string | LoginUrl);
switchInline(text: MaybeDynamic<C, string> | TextWithOptions<C>, query: string);
switchInlineCurrent(text: MaybeDynamic<C, string> | TextWithOptions<C>, query: string);
switchInlineChosen(text: MaybeDynamic<C, string> | TextWithOptions<C>, query: SwitchInlineQueryChosenChat);
copyText(text: MaybeDynamic<C, string> | TextWithOptions<C>, copyText: string | CopyTextButton);
game(text: MaybeDynamic<C, string> | TextWithOptions<C>);
pay(text: MaybeDynamic<C, string> | TextWithOptions<C>);
```

Navigation and dynamic layout:

```ts
submenu(
  text: MaybeDynamic<C, string>,
  menu: string,
  ...middleware: MenuMiddleware<C>[],
): this;
submenu(
  text: TextWithPayload<C>,
  menu: string,
  ...middleware: MenuMiddleware<C & { match: string }>[],
): this;
submenu(
  text: MaybeDynamic<C, string> | TextWithPayload<C>,
  menu: string,
  ...middleware: MenuMiddleware<C>[],
): this;

back(text: MaybeDynamic<C, string>, ...middleware: MenuMiddleware<C>[]): this;
back(text: TextWithPayload<C>, ...middleware: MenuMiddleware<C & { match: string }>[]): this;
back(text: MaybeDynamic<C, string> | TextWithPayload<C>, ...middleware: MenuMiddleware<C>[]): this;

dynamic(
  rangeBuilder: (ctx: C, range: MenuRange<C>) =>
    MaybePromise<MaybeRawRange<C> | void>,
);
```

Special button constraints from Telegram:

| Button | Constraint |
| --- | --- |
| `game` | Must be the first button in the first row. |
| `pay` | Must be the first button in the first row and only belongs in invoice messages. |
| `url` | Telegram opens the URL directly; the bot is not notified by this button press. |

## Usage Patterns

### Basic menu

```ts
import { Bot } from "grammy";
import { Menu } from "@grammyjs/menu";

const bot = new Bot(process.env.BOT_TOKEN ?? "");

const menu = new Menu("main")
  .text("Download", (ctx) => ctx.reply("Starting download")).row()
  .text("Help", (ctx) => ctx.reply("Choose a command"));

bot.use(menu);

bot.command("start", (ctx) =>
  ctx.reply("Choose an action", { reply_markup: menu })
);
```

Install menu middleware before middleware that consumes callback query data. If `allowed_updates` is configured manually, include `callback_query`.

### Custom context

```ts
type MyContext = Context & MenuFlavor;

const menu = new Menu<MyContext>("settings");
```

### Dynamic label with explicit update

```ts
const menu = new Menu<MyContext>("settings")
  .text(
    (ctx) => ctx.session.enabled ? "Enabled" : "Disabled",
    (ctx) => {
      ctx.session.enabled = !ctx.session.enabled;
      ctx.menu.update();
    },
  );
```

Call `ctx.menu.update()` when a handler changes state that affects labels or dynamic ranges. If the handler edits the message after calling a control-panel method, the plugin injects the new menu into that edit. Otherwise it sends a dedicated menu update after middleware completes.

### Closing or eager updates

```ts
const menu = new Menu("confirm")
  .text("Cancel", (ctx) => ctx.menu.close())
  .text("Refresh now", async (ctx) => {
    await ctx.menu.update({ immediate: true });
  });
```

Prefer lazy control-panel calls unless immediate visual feedback is necessary.

### Navigation

```ts
const main = new Menu("root")
  .text("Home", (ctx) => ctx.reply("Already here")).row()
  .submenu("Settings", "settings");

const settings = new Menu("settings")
  .text("Toggle", (ctx) => {
    ctx.session.enabled = !ctx.session.enabled;
    ctx.menu.update();
  })
  .back("Back");

main.register(settings);
bot.use(main);
```

Register submenus on the root or parent menu. For a linked hierarchy, only install the root menu with `bot.use`. Independent menus that do not navigate between each other should each be installed.

### Payloads

```ts
const menu = new Menu<MyContext>("page")
  .text(
    { text: "Open item", payload: (ctx) => String(ctx.session.selectedId) },
    (ctx) => ctx.reply(`Selected ${ctx.match}`),
  );
```

Use payloads for short identifiers, indexes, or small state hints. Store real user data in sessions or persistent storage.

### Dynamic ranges

```ts
const menu = new Menu<MyContext>("items");

menu.dynamic((ctx, range) => {
  for (const item of ctx.session.items) {
    range
      .text(item.title, (ctx) => ctx.reply(item.id))
      .row();
  }
});
```

Dynamic builders may be async. They should be stable for the same relevant state and free of side effects, because the menu may be rendered when sending and again when handling a callback query.

### Manual callback answers

```ts
const menu = new Menu("manual-answer", { autoAnswer: false })
  .text("Run", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Running" });
    await ctx.reply("Started");
  });
```

Use `autoAnswer: false` only when handlers provide their own callback-query answer.

### Outdated menu handling

```ts
const menu = new Menu<MyContext>("stateful", {
  onMenuOutdated: "Updated. Press the button again.",
  fingerprint: (ctx) => String(ctx.session.version),
});
```

The default outdated-menu heuristic considers the menu id, shape, pressed-button position, and pressed-button label. Use a fingerprint when this is not enough or when those differences should not make a menu stale.

## Configuration

| Configuration | Use when | Notes |
| --- | --- | --- |
| `autoAnswer: false` | The handler needs a custom `answerCallbackQuery` message or behavior. | Without it, the plugin answers callback queries automatically for menu buttons. |
| `onMenuOutdated: string` | You want a custom notice for stale menu clicks. | The menu is still updated. |
| `onMenuOutdated: MenuMiddleware<C>` | You want full control when a stale menu is clicked. | The middleware should update the menu or send a fresh menu. |
| `onMenuOutdated: false` | You intentionally want to skip stale-menu checks. | Risk: handlers may run for a layout that no longer matches the visible menu. |
| `fingerprint` | The built-in staleness heuristic is too broad or too narrow. | Return a string that changes exactly when the menu should be considered different. |

## Best Practices

1. Define menus at startup, outside update handlers. Use dynamic ranges for runtime layouts.
2. Install menu middleware before callback-query-consuming middleware.
3. Register nested menus and install only the root menu for that hierarchy.
4. Use `ctx.menu.update()` after changing state that controls dynamic labels or dynamic ranges.
5. Keep dynamic range builders deterministic and side-effect free.
6. Keep payloads short, typically ids or indexes. Use session or storage for actual data.
7. Use lazy `ctx.menu` operations by default; reserve `{ immediate: true }` for cases that need eager UI changes.
8. Add `callback_query` to custom `allowed_updates`.
9. Use `fingerprint` when business state changes without changing shape or labels, or when harmless label/layout differences should not mark a menu stale.

## Common Pitfalls

`ctx.menu` used outside a menu handler: The control panel is only available inside handlers registered on the menu.

Menu created in an update handler: This can leak memory and break rendering assumptions. Define menus once, then generate dynamic ranges from context.

Dynamic builder depends on time or randomness: The callback-query render can differ from the send-time render, causing stale-menu behavior or wrong handler matching.

Large payloads: Payloads are for short strings, not URLs, file ids, or durable user data.

Child submenu installed separately: For a registered hierarchy, install the root. Install multiple menus separately only when they are independent.

Forgotten menu update: Dynamic labels and dynamic ranges do not change on screen unless the menu is updated or the message edit is combined with the menu update.

Manual `answerCallbackQuery` with `autoAnswer` still enabled: Usually leave automatic answering on, or disable it when custom answers are needed.

Direct send through `bot.api.sendMessage`: The `Menu` API page notes that sending menus directly through `bot.api.sendMessage` is not currently supported in the same way as sending through the context object.

## Version Notes

The fetched guide shows Node examples using `grammy` plus `@grammyjs/menu`. Its Deno example imports `grammy@v1.42.0` and `grammy_menu@v1.3.1`. The fetched pages do not provide a complete compatibility matrix.

