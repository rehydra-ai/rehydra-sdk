/**
 * Rehydra Proxy Middleware
 * Generic (Request → Response) proxy that anonymizes LLM requests
 * and rehydrates responses. Uses standard Web APIs — no framework dependency.
 */

import { createRehydraFetch } from "./rehydra-fetch.js";
import type { RehydraProxyConfig } from "./types.js";

const DEFAULT_FORWARD_HEADERS = [
  "authorization",
  "content-type",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "openai-organization",
  "openai-project",
];

/**
 * Creates a proxy middleware function that forwards requests to an upstream
 * LLM API, anonymizing requests and rehydrating responses.
 *
 * Returns a standard `(Request) => Promise<Response>` function that works
 * with any framework supporting Web Request/Response APIs.
 *
 * @example
 * ```typescript
 * // Hono
 * import { Hono } from 'hono';
 * const app = new Hono();
 * const proxy = createRehydraProxy({
 *   upstream: 'https://api.openai.com',
 *   keyProvider: new ConfigKeyProvider(process.env.PII_KEY!),
 *   piiStorageProvider: new SQLitePIIStorageProvider('proxy.db'),
 * });
 * app.post('/v1/*', (c) => proxy(c.req.raw));
 * ```
 *
 * @example
 * ```typescript
 * // Bun.serve
 * const proxy = createRehydraProxy({ upstream: 'https://api.openai.com', ... });
 * Bun.serve({
 *   fetch(req) {
 *     if (new URL(req.url).pathname.startsWith('/v1/')) return proxy(req);
 *     return new Response('Not Found', { status: 404 });
 *   },
 * });
 * ```
 */
export function createRehydraProxy(
  config: RehydraProxyConfig,
): (request: Request) => Promise<Response> {
  const forwardHeaders = config.forwardHeaders ?? DEFAULT_FORWARD_HEADERS;
  const upstream = config.upstream.replace(/\/$/, ""); // Remove trailing slash

  // Create the underlying Rehydra fetch wrapper
  const rehydraFetch = createRehydraFetch(config);

  return async (request: Request): Promise<Response> => {
    // Build upstream URL
    const requestUrl = new URL(request.url);
    let pathname = requestUrl.pathname;

    // Strip prefix if configured
    if (config.stripPrefix !== undefined && config.stripPrefix !== "" && pathname.startsWith(config.stripPrefix)) {
      pathname = pathname.slice(config.stripPrefix.length);
      if (!pathname.startsWith("/")) {
        pathname = "/" + pathname;
      }
    }

    const upstreamUrl = upstream + pathname + requestUrl.search;

    // Filter headers to forward
    const headers = new Headers();
    for (const name of forwardHeaders) {
      const value = request.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }
    // Inject proxy-configured API key, replacing any client auth headers.
    // This is needed when the client uses OAuth (e.g. Claude Code with Max)
    // but the upstream only accepts API key auth.
    if (config.apiKey !== undefined) {
      headers.delete("authorization");
      if (upstreamUrl.includes("anthropic")) {
        headers.set("x-api-key", config.apiKey);
      } else {
        headers.set("authorization", `Bearer ${config.apiKey}`);
      }
    } else if (headers.has("x-api-key") && headers.has("authorization")) {
      // When client sends both, prefer API key over OAuth token
      headers.delete("authorization");
    }
    // Disable upstream compression — the proxy reads and modifies the response
    // body, so we need it uncompressed. Without this, Node's fetch may
    // auto-decompress but leave content-encoding headers, causing ZlibError
    // on clients that try to decompress the already-decompressed body.
    headers.set("accept-encoding", "identity");

    // Forward via rehydraFetch (which handles anonymization/rehydration)
    return rehydraFetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error - duplex is needed for streaming request bodies
      duplex: "half",
    });
  };
}
