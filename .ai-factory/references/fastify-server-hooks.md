# Fastify Server and Hooks Reference

> Source:
> - https://fastify.dev/docs/v5.5.x/Reference/Server/
> - https://fastify.dev/docs/latest/Reference/Hooks/
> - https://fastify.dev/docs/latest/Reference/Server/#handlertimeout
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

This reference summarizes Fastify server factory configuration, commonly used instance APIs, router options, shutdown behavior, and hook lifecycle behavior. It is optimized for implementing or reviewing Fastify services and plugins.

Version scope matters: the Server source URL is Fastify v5.5.x, while the Hooks source URL resolves to latest v5.8.x on 2026-04-27. The latest Server page was consulted only for `handlerTimeout`, because the latest Hooks page references it.

## Core Concepts

Fastify factory: `fastify(options)` creates a Fastify server instance. The options object controls Node server behavior, logging, routing, schema compilation, error handling, request ids, and shutdown behavior.

Encapsulation: plugins create nested contexts. Most hooks, decorators, schemas, custom error handlers, log factories, and request-id generators are scoped to the current Fastify context.

Lifecycle hooks: hooks must be registered before the relevant lifecycle event is triggered. Request/reply hooks run during request handling; application hooks run during startup, route/plugin registration, or shutdown.

Callback vs async hooks: do not mix `done` callbacks with `async`/Promise-returning hooks. In async hooks, the `done` callback is unavailable and calling it can cause duplicate lifecycle execution.

Router: Fastify uses `find-my-way`. `routerOptions` are passed through to customize matching, constraints, parameter limits, query parsing, and bad URL handling.

## API / Interface

### Factory Options

| Option | Default | Notes |
| --- | --- | --- |
| `http` | `null` | Node HTTP server options. Ignored if `http2` or `https` is set. |
| `http2` | `false` | Use Node HTTP/2 for the listening socket. |
| `https` | `null` | TLS server options; also applies with `http2`. |
| `connectionTimeout` | `0` | Socket timeout in milliseconds. Ignored with `serverFactory`. |
| `keepAliveTimeout` | `72000` | HTTP/1 keep-alive timeout in milliseconds. Ignored with `serverFactory`. |
| `forceCloseConnections` | `"idle"` if supported, else `false` | Controls persistent socket destruction during `close()`. `true` destroys current persistent connections; `"idle"` destroys idle ones if supported. |
| `maxRequestsPerSocket` | `0` | HTTP/1.1 request cap per socket. Ignored with `serverFactory`. |
| `requestTimeout` | `0` | Maximum time to receive the full client request. Fastify docs recommend a non-zero value when deployed without a reverse proxy to reduce DoS exposure. |
| `bodyLimit` | `1048576` | Maximum accepted payload bytes. With `preParsing`, applies to the returned decoded stream. |
| `onProtoPoisoning` | `'error'` | JSON `__proto__` handling: `'error'`, `'remove'`, or `'ignore'`. |
| `onConstructorPoisoning` | `'error'` | JSON `constructor` handling: `'error'`, `'remove'`, or `'ignore'`. |
| `logger` | `false` | `false` disables logging; object values are passed to Pino. |
| `loggerInstance` | `null` | Custom Pino-compatible logger with `info`, `error`, `debug`, `fatal`, `warn`, `trace`, and `child`. |
| `disableRequestLogging` | `false` | Disables Fastify's built-in request start/end logs and related default error/not-found logs. Latest docs also allow a function predicate. |
| `serverFactory` | none | Function receiving `(handler, opts)` and returning a Node-compatible server. |
| `requestIdHeader` | v5.5.x docs show `'request-id'` and also document `false` behavior | Header name for request id. `true` maps to `"request-id"`; empty string disables header usage. |
| `requestIdLogLabel` | `'reqId'` | Logger field name for request id. |
| `genReqId` | header value if available, otherwise monotonic integers | Synchronous, error-free raw request id generator. Not called when the configured request-id header is present. |
| `trustProxy` | `false` | Boolean, string/CIDR list, array, hop number, or trust function. Enables trusted `X-Forwarded-*` derived request fields. |
| `pluginTimeout` | `10000` | Milliseconds allowed for plugin loading. `0` disables this check. |
| `exposeHeadRoutes` | `true` | Auto-creates sibling `HEAD` routes for `GET`; define custom `HEAD` before `GET` if needed. |
| `return503OnClosing` | `true` | New requests receive 503 after `close()` starts. |
| `ajv` | Fastify default Ajv v8 config | Configures Fastify's Ajv instance without replacing it. |
| `serializerOpts` | default `fast-json-stringify` options | Customizes response serializer options. |
| `http2SessionTimeout` | `72000` | Timeout applied to HTTP/2 sessions for graceful close and DoS mitigation. |
| `frameworkErrors` | `null` | Override implemented framework handlers; docs mention `FST_ERR_BAD_URL` and `FST_ERR_ASYNC_CONSTRAINT`. |
| `clientErrorHandler` | built-in 400 response handler | Raw socket handler for client connection errors. Must write a valid HTTP response and check socket writability. |
| `rewriteUrl` | none | Synchronous root-instance callback that rewrites raw request URLs before routing. Not encapsulated. |
| `allowErrorHandlerOverride` | `true` in v5.5.x | When `false`, prevents multiple `setErrorHandler` calls in the same scope. v5.5.x docs warn this default will change in the next major release. |
| `handlerTimeout` | `0` in latest v5.8.x | Latest-only: application-level request lifecycle timeout. Sends 503, aborts `request.signal`, can be overridden per route, and is cooperative. |

### Router Options

| Option | Default | Notes |
| --- | --- | --- |
| `allowUnsafeRegex` | `false` | Allows unsafe route regex patterns. Keep disabled unless there is a strong reason. |
| `buildPrettyMeta` | none | Sanitizes route store metadata before pretty printing. |
| `caseSensitive` | `true` | When `false`, paths match case-insensitively, but route params and wildcards preserve casing. |
| `constraints` | built-ins | Configure or override `find-my-way` route constraints such as `version` and `host`. |
| `defaultRoute` | find-my-way default | Custom route for unmatched requests. |
| `ignoreDuplicateSlashes` | `false` | Normalizes duplicate slashes in route paths and request URLs. |
| `ignoreTrailingSlash` | `false` | Treats `/foo` and `/foo/` as the same route. |
| `maxParamLength` | `100` | Param length limit for parametric routes; exceeded values invoke not-found handling. |
| `onBadUrl` | none | Custom handler for malformed URLs. |
| `querystringParser` | Fastify parser in factory option; Node `querystring` in v5.5.x router section | Custom query parser, commonly `qs` or a case-normalizing parser. |
| `useSemicolonDelimiter` | `false` | Enables `;` as a path/query delimiter for backwards compatibility. |

### Instance Methods and Properties

| API | Signature / Shape | Notes |
| --- | --- | --- |
| `fastify.server` | Node server object | Prefer using it for listeners only; misuse can break Fastify features. |
| `after` | `fastify.after(callback?)` | Runs after the current plugin and nested registrations finish loading; Promise form if no callback. |
| `ready` | `fastify.ready(callback?)` | Runs after all plugins load; Promise form if no callback. |
| `listen` | `fastify.listen([options][, callback])` | Starts server after `.ready()`. Default listen options include `port: 0` and `host: 'localhost'`. Use `host: '0.0.0.0'` in containers when mapped ports must be reachable externally. |
| `addresses` | `fastify.addresses()` | Returns listening addresses; empty before `listen()` or after `close()`. |
| `routing` | `fastify.routing(req, res)` | Direct router lookup entry point. |
| `route` | `fastify.route(options)` | Adds a route; shorthand methods also exist. |
| `hasRoute` | `fastify.hasRoute({ url, method, constraints? })` | Returns boolean. |
| `findRoute` | `fastify.findRoute({ url, method, constraints? })` | Returns a route object or `null`. |
| `close` | `fastify.close(callback?)` | Closes the server, runs `onClose`, and returns a Promise when no callback is passed. |
| `decorate*` | instance/reply/request decorators | See decorators docs for details; decorators are encapsulated. |
| `register` | `fastify.register(plugin, opts?)` | Adds plugins, routes, decorators, hooks, or other behavior in an encapsulated context. |
| `addHook` | `fastify.addHook(name, fn)` | Registers lifecycle hooks. |
| `prefix` | `fastify.prefix` | Current route prefix for the context. |
| `pluginName` | `fastify.pluginName` | Current plugin name, derived from `fastify-plugin` metadata, display-name symbol, filename, function name, or fallback. |
| `hasPlugin` | `fastify.hasPlugin(name)` | Checks registered plugin metadata name after registration/ready. |
| `listeningOrigin` | `fastify.listeningOrigin` | Current origin or Unix socket path. |
| `log` | `fastify.log` | Logger instance. |
| `version` | `fastify.version` | Fastify instance version. |
| `inject` | `fastify.inject(...)` | In-memory HTTP injection for tests. |
| `addHttpMethod` | `fastify.addHttpMethod(method, opts?)` | Adds non-standard HTTP methods, optionally marking body support. |
| `addSchema` | `fastify.addSchema(schemaObj)` | Adds shared JSON Schema. |
| `getSchemas` | `fastify.getSchemas()` | Returns schemas keyed by `$id`. |
| `getSchema` | `fastify.getSchema(id)` | Returns one schema or `undefined`. |
| `setReplySerializer` | `fastify.setReplySerializer(fn)` | Sets default serializer for 2xx payloads; has priority over schema serializer compiler. |
| `setValidatorCompiler` | `fastify.setValidatorCompiler(fn)` | Sets schema validator compiler. |
| `setSchemaErrorFormatter` | `fastify.setSchemaErrorFormatter(fn)` | Formats schema validation errors. |
| `setSerializerCompiler` | `fastify.setSerializerCompiler(fn)` | Sets schema serializer compiler. |
| `validatorCompiler` | property | Null until set or server starts; compiler signature receives `{ schema, method, url, httpPart }`. |
| `serializerCompiler` | property | Null until set or server starts; compiler signature in docs mirrors validator compiler wording. |
| `schemaErrorFormatter` | property | Function for validation error formatting. |
| `schemaController` | option/property | Lets applications fully control schema storage and compiler factories. |
| `setNotFoundHandler` | `fastify.setNotFoundHandler([opts], handler?)` | Encapsulated by prefix. Handler runs through the Fastify lifecycle and can use `preValidation` and `preHandler` hooks. |
| `setErrorHandler` | `fastify.setErrorHandler(handler(error, request, reply))` | Encapsulated custom error handler. Does not catch `onResponse` exceptions or 404s. |
| `setChildLoggerFactory` | `fastify.setChildLoggerFactory(factory(logger, bindings, opts, rawReq))` | Encapsulated child logger customization. |
| `setGenReqId` | `fastify.setGenReqId(function (rawReq))` | Encapsulated synchronous request-id generator. |
| `addConstraintStrategy` | `fastify.addConstraintStrategy(strategy)` | Adds a route constraint strategy with storage and derive functions. |
| `hasConstraintStrategy` | `fastify.hasConstraintStrategy(strategyName)` | Checks whether a constraint strategy exists. |
| `printRoutes` | `fastify.printRoutes(options?)` | Pretty prints routes. Use `method` for internal router debugging. `includeMeta` and `includeHooks` expose route metadata. Call inside or after `ready()`. |
| `printPlugins` | `fastify.printPlugins()` | Prints Avvio plugin tree. Call inside or after `ready()`. |
| `addContentTypeParser` | `fastify.addContentTypeParser(contentType, options, parser)` | Adds custom parser for string, string array, or RegExp content types. |
| `hasContentTypeParser` | `fastify.hasContentTypeParser(contentType)` | Checks parser in current context. |
| `removeContentTypeParser` | `fastify.removeContentTypeParser(contentType)` | Removes parser(s) in current context. |
| `removeAllContentTypeParsers` | `fastify.removeAllContentTypeParsers()` | Removes all parsers in current context, often before a catch-all parser. |
| `getDefaultJsonParser` | `fastify.getDefaultJsonParser(onProtoPoisoning, onConstructorPoisoning)` | Returns default JSON parser configured for poisoning behavior. |
| `defaultTextParser` | `fastify.defaultTextParser` | Parser for plain text. |
| `errorHandler` | `fastify.errorHandler` | Default Fastify error handler. |
| `childLoggerFactory` | `fastify.childLoggerFactory` | Current child logger factory function. |
| `Symbol.asyncDispose` | `fastify[Symbol.asyncDispose]` | Async disposal hook for closing Fastify, useful with TypeScript `using`. |
| `initialConfig` | frozen object | Exposes selected initial options: timeouts, `bodyLimit`, `http2`, `https`, poisoning behavior, request-id options, `http2SessionTimeout`, and selected `routerOptions`. |

### Hook Signatures

| Hook | Signature | Timing / Use |
| --- | --- | --- |
| `onRequest` | `(request, reply, done)` or `async (request, reply)` | First request hook. `request.body` is always `undefined`. |
| `preParsing` | `(request, reply, payload, done)` or `async (request, reply, payload)` | Transform request payload stream before parsing. Returned value must be a stream. |
| `preValidation` | `(request, reply, done)` or `async (request, reply)` | Modify body before validation. |
| `preHandler` | `(request, reply, done)` or `async (request, reply)` | Run immediately before route handler; common for auth/authorization. |
| `preSerialization` | `(request, reply, payload, done)` or `async (request, reply, payload)` | Replace payload before serialization. Not called for `string`, `Buffer`, stream, or `null` payloads. |
| `onError` | `(request, reply, error, done)` or `async (request, reply, error)` | Custom logging/headers before custom error handler. Do not mutate the error or call `reply.send`. Passing an error to `done` is unsupported. |
| `onSend` | `(request, reply, payload, done)` or `async (request, reply, payload)` | Change outbound payload. Replacement must be `string`, `Buffer`, stream, `ReadableStream`, `Response`, or `null`. |
| `onResponse` | `(request, reply, done)` or `async (request, reply)` | After response has been sent; cannot send more data. Useful for metrics or external logging. |
| `onTimeout` | `(request, reply, done)` or `async (request, reply)` | Runs after socket timeout and hang-up; cannot send data. Latest docs distinguish this from route `handlerTimeout`. |
| `onRequestAbort` | `(request, done)` or `async (request)` | Runs when the client closes before processing completes. Detection is not completely reliable. |
| `onReady` | `(done)` or `async ()` | Before listen and when `.ready()` is invoked. Cannot add routes or hooks. Runs serially. |
| `onListen` | `(done)` or `async ()` | After server starts listening. Errors are logged and ignored. Does not run for `inject()` or `ready()`. |
| `onClose` | `(instance, done)` or `async (instance)` | Shutdown cleanup after the HTTP server has stopped listening and in-flight requests have completed. Child plugin hooks execute before parent hooks. |
| `preClose` | `(done)` or `async ()` | Shutdown cleanup before in-flight requests complete; useful for state that would prevent `server.close()` such as WebSockets or SSE. |
| `onRoute` | `(routeOptions)` | Synchronous, encapsulated, no callback. Runs when a route is registered. Can mutate route options. |
| `onRegister` | `(instance, opts)` | Runs before registered plugin code when a new encapsulation context is created. Not called for plugins wrapped in `fastify-plugin`. |

## Usage Patterns

### Basic Server Startup

```js
const Fastify = require('fastify')

const fastify = Fastify({
  logger: true,
  requestTimeout: 120000
})

fastify.get('/health', async () => ({ ok: true }))

await fastify.listen({ port: 3000, host: '0.0.0.0' })
```

Use `host: '0.0.0.0'` for containers when the service must be reachable through mapped ports. For local-only development, Fastify's default `localhost` behavior is safer.

### Encapsulated Error Handling

```js
fastify.register(async function api (instance) {
  instance.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error })
    reply.code(error.statusCode || 500).send({ error: error.message })
  })

  instance.get('/items/:id', async (request) => {
    return { id: request.params.id }
  })
}, { prefix: '/api' })
```

`setErrorHandler` is scoped to the plugin context. Use `setNotFoundHandler` for 404s, because `setErrorHandler` does not handle not-found responses.

### Early Reply From Auth Hook

```js
fastify.addHook('preHandler', async (request, reply) => {
  if (!request.headers.authorization) {
    reply.code(401).send({ error: 'Unauthorized' })
    return reply
  }
})
```

In async hooks, return `reply` when the response is sent outside the promise chain or when you need to signal that processing should wait for the reply.

### Request Data Injection With TypeScript

```ts
interface AuthenticatedUser {
  id: number
  role: string
}

declare module 'fastify' {
  export interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser
  }
}
```

Use custom property names that do not collide with existing request properties. For broader changes to core objects, prefer a plugin over ad hoc mutation.

### Route Introspection

```js
await fastify.ready()

console.log(fastify.printRoutes({ includeHooks: true }))
console.log(fastify.printPlugins())
```

Call route/plugin printers inside or after `ready()`. Use `printRoutes({ method: 'GET' })` when debugging the internal router tree.

## Configuration

### Security-Relevant Defaults

| Area | Source behavior | Practical note |
| --- | --- | --- |
| Request timeout | `requestTimeout` defaults to `0` | Set a non-zero value when exposed without a reverse proxy. |
| Body size | `bodyLimit` defaults to 1 MiB | Increase only for routes that need larger payloads. |
| Prototype poisoning | `onProtoPoisoning` and `onConstructorPoisoning` default to `'error'` | Keep error behavior unless you have a compatibility requirement. |
| Regex routes | `allowUnsafeRegex` defaults to `false` | Avoid enabling globally; unsafe regex routes can create ReDoS risk. |
| Proxy trust | `trustProxy` defaults to `false` | Enable only for known proxy paths; trusted forwarded headers are otherwise spoofable. |
| Request id header | Header-derived IDs can be caller-controlled | Validate or generate IDs yourself if request IDs drive trace/security behavior. |
| Shutdown | `return503OnClosing` defaults to `true` | New requests get 503 after close starts; existing requests are drained before `onClose`. |

### Hook Ordering

Request/reply hooks run in lifecycle order:

1. `onRequest`
2. `preParsing`
3. `preValidation`
4. `preHandler`
5. route handler
6. `preSerialization`
7. `onSend`
8. `onResponse`

Error/termination hooks fit around this lifecycle:

1. `onError` runs before the custom error handler when a request lifecycle error occurs.
2. `onTimeout` runs after a socket timeout and hang-up.
3. `onRequestAbort` runs when the client aborts before processing completes.

Route-level hooks can be declared for `onRequest`, `onResponse`, `preParsing`, `preValidation`, `preHandler`, `preSerialization`, `onSend`, `onTimeout`, and `onError`. Route-level hooks run after shared hooks in the same category and can be arrays.

## Best Practices

1. Register hooks before the lifecycle events they need to observe; late hooks do not receive past events.
2. Choose one hook style per hook: callback with `done`, or async/Promise. Mixing both can execute the hook chain twice.
3. Use `preHandler` or `preValidation` for authentication/authorization that may stop a request before handler execution.
4. Use `onResponse` for metrics or side effects after the response has gone out; use `onSend` if you need to modify the response.
5. Keep `onError` for logging or headers only; use `setErrorHandler` to shape the error response.
6. Use function declarations when a hook needs `this` bound to the Fastify context; arrow functions capture the outer `this`.
7. Use `onClose` for normal resource cleanup; use `preClose` only for state that would block server shutdown.
8. Set `requestTimeout` and appropriate `bodyLimit` values for public services.
9. Prefer encapsulated plugins for per-area configuration: schemas, hooks, error handlers, log factories, request IDs, and parsers.
10. If `onRoute` adds routes, tag processed routes to avoid infinite registration loops.

## Common Pitfalls

Mixing callbacks and async hooks: calling `done()` inside an async hook can duplicate lifecycle execution.

Reading `request.body` too early: `onRequest` and `preParsing` always see `request.body` as `undefined`; body parsing completes before `preValidation`.

Returning non-stream values from `preParsing`: if `preParsing` returns a value, it must be a stream, and the returned stream should maintain `receivedEncodedLength`.

Trying to send from `onError` or `onResponse`: `onError` cannot use `reply.send`, and `onResponse` runs after data is sent.

Assuming abort detection is perfect: `onRequestAbort` is useful but not fully reliable.

Overriding error handlers accidentally: `allowErrorHandlerOverride: true` permits multiple `setErrorHandler` calls in one scope in v5.5.x; set it to `false` to catch accidental overrides.

Using `fastify.server` as an escape hatch: the docs warn that improper use can disrupt Fastify behavior; attach listeners only unless you know the internals.

Binding to all interfaces by default: `0.0.0.0` is useful in containers, but it exposes the server more broadly than `localhost`.

## Version Notes

Fastify latest resolved to v5.8.x on 2026-04-27. The provided Server URL targets v5.5.x, while the provided Hooks URL targets latest.

`handlerTimeout` appears in latest v5.8.x Server docs and is referenced by latest Hooks docs. It was not present in the fetched v5.5.0 Server markdown. Treat it as latest-version behavior unless the project is confirmed to depend on a Fastify version that includes it.

The v5.5.x Server docs state that `allowErrorHandlerOverride` defaults to `true` and warn that it will default to `false` in the next major release.

The latest Server docs add newer details not present in v5.5.x, including `handlerTimeout`, conditional `disableRequestLogging`, extra `forceCloseConnections` HTTP/2 notes, and a warning about caller-controlled request IDs when `requestIdHeader` is enabled.
