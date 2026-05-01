import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { isBlockedHostname, isBlockedNetworkAddress, normalizeHostname } from "../core/validation.js";
import { noopLogger, type Logger } from "../core/logger.js";

export type ResolvedPublicAddress = {
  address: string;
  family: 4 | 6;
};

export type EgressProxy = {
  proxyUrl: string;
  stop: () => Promise<void>;
};

export type ResolvePublicAddressOptions = {
  forceIpv4?: boolean;
  lookup?: typeof dns.promises.lookup;
  logger?: Logger;
};

class EgressDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressDeniedError";
  }
}

function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

function toPort(value: string | undefined, protocol: string): number {
  const parsed = value ? Number(value) : defaultPort(protocol);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new EgressDeniedError("Invalid upstream port");
  }
  return parsed;
}

function publicAddressFromLiteral(hostname: string): ResolvedPublicAddress | undefined {
  const normalized = normalizeHostname(hostname);
  const family = net.isIP(normalized);
  if (family === 0) return undefined;
  if (isBlockedNetworkAddress(normalized)) {
    throw new EgressDeniedError("Blocked private network address");
  }
  return { address: normalized, family: family === 6 ? 6 : 4 };
}

export async function resolvePublicAddress(
  hostname: string,
  { forceIpv4 = false, lookup = dns.promises.lookup, logger = noopLogger }: ResolvePublicAddressOptions = {},
): Promise<ResolvedPublicAddress> {
  const normalized = normalizeHostname(hostname);
  if (isBlockedHostname(normalized)) {
    logger.warn("egress_proxy.blocked_hostname");
    throw new EgressDeniedError("Blocked private network hostname");
  }

  const literal = publicAddressFromLiteral(normalized);
  if (literal) return literal;

  const results = await lookup(normalized, { all: true, family: forceIpv4 ? 4 : 0, verbatim: false });
  if (results.length === 0) {
    throw new EgressDeniedError("Host did not resolve");
  }

  const blockedResult = results.find((result) => isBlockedNetworkAddress(result.address));
  if (blockedResult) {
    logger.warn("egress_proxy.blocked_resolved_address", { family: blockedResult.family });
    throw new EgressDeniedError("Host resolved to a private network address");
  }

  const selected = results[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new EgressDeniedError("Host resolved to an unsupported address family");
  }

  return { address: selected.address, family: selected.family };
}

function parseHttpProxyRequestUrl(request: http.IncomingMessage): URL {
  const rawUrl = request.url ?? "/";
  if (/^https?:\/\//i.test(rawUrl)) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:") {
      throw new EgressDeniedError("HTTPS proxy requests must use CONNECT");
    }
    return parsed;
  }

  const host = request.headers.host;
  if (!host) {
    throw new EgressDeniedError("Missing upstream host");
  }
  return new URL(`http://${host}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`);
}

function parseConnectTarget(request: http.IncomingMessage): { hostname: string; port: number } {
  const rawUrl = request.url;
  if (!rawUrl) {
    throw new EgressDeniedError("Missing CONNECT target");
  }

  const parsed = new URL(`https://${rawUrl}`);
  return {
    hostname: parsed.hostname,
    port: toPort(parsed.port, "https:"),
  };
}

function sanitizedProxyHeaders(headers: http.IncomingHttpHeaders, host: string): http.OutgoingHttpHeaders {
  const nextHeaders: http.OutgoingHttpHeaders = { ...headers, host };
  delete nextHeaders["proxy-authorization"];
  delete nextHeaders["proxy-connection"];
  return nextHeaders;
}

async function connectToUpstream(
  hostname: string,
  port: number,
  options: ResolvePublicAddressOptions,
): Promise<net.Socket> {
  const resolved = await resolvePublicAddress(hostname, options);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: resolved.address, port, family: resolved.family });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function absorbSocketError(socket: net.Socket, logger: Logger, side: "client" | "upstream"): void {
  socket.on("error", (error) => {
    logger.debug("egress_proxy.socket_error", {
      side,
      code: (error as NodeJS.ErrnoException).code,
      message: error.message,
    });
  });
}

export async function createPrivateNetworkDeniedProxy({
  forceIpv4 = false,
  logger = noopLogger,
}: {
  forceIpv4?: boolean;
  logger?: Logger;
} = {}): Promise<EgressProxy> {
  const sockets = new Set<net.Socket>();
  const resolveOptions = { forceIpv4, logger };

  const server = http.createServer(async (request, response) => {
    let target: URL;
    try {
      target = parseHttpProxyRequestUrl(request);
      const port = toPort(target.port, target.protocol);
      const resolved = await resolvePublicAddress(target.hostname, resolveOptions);
      const upstreamRequest = http.request({
        hostname: resolved.address,
        port,
        family: resolved.family,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: sanitizedProxyHeaders(request.headers, target.host),
      });

      upstreamRequest.on("response", (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      });
      upstreamRequest.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end("Bad gateway");
      });
      request.pipe(upstreamRequest);
    } catch (error) {
      logger.warn("egress_proxy.http_blocked", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      response.writeHead(error instanceof EgressDeniedError ? 403 : 400);
      response.end("Blocked by egress policy");
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    absorbSocketError(socket, logger, "client");
    socket.once("close", () => sockets.delete(socket));
  });

  server.on("connect", async (request, clientSocket, head) => {
    try {
      const target = parseConnectTarget(request);
      const upstreamSocket = await connectToUpstream(target.hostname, target.port, resolveOptions);
      absorbSocketError(upstreamSocket, logger, "upstream");
      upstreamSocket.once("close", () => clientSocket.destroy());
      clientSocket.once("close", () => upstreamSocket.destroy());
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    } catch (error) {
      logger.warn("egress_proxy.connect_blocked", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Egress proxy did not bind to a TCP port");
  }

  logger.debug("egress_proxy.started", { port: address.port });

  return {
    proxyUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      logger.debug("egress_proxy.stopped");
    },
  };
}

export async function withPrivateNetworkDeniedProxy<T>(
  options: { forceIpv4?: boolean; logger?: Logger },
  callback: (proxyUrl: string) => Promise<T>,
): Promise<T> {
  const proxy = await createPrivateNetworkDeniedProxy(options);
  try {
    return await callback(proxy.proxyUrl);
  } finally {
    await proxy.stop();
  }
}
