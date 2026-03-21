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
