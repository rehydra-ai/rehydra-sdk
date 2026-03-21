/**
 * Rehydra Proxy Server
 * Standalone HTTP server that proxies LLM API requests with
 * automatic PII anonymization and rehydration.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createRehydraProxy } from "./rehydra-proxy.js";
import type { RehydraProxyConfig } from "./types.js";

/**
 * Configuration for the standalone proxy server
 */
export interface RehydraProxyServerConfig extends RehydraProxyConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to (default: "127.0.0.1") */
  host?: string;
}

/**
 * A running Rehydra proxy server
 */
export interface RehydraProxyServer {
  /** The underlying HTTP server */
  server: Server;
  /** The port the server is listening on */
  port: number;
  /** The host the server is bound to */
  host: string;
  /** Gracefully close the server */
  close(): Promise<void>;
}

/**
 * Creates and starts a standalone HTTP proxy server that anonymizes
 * LLM API requests and rehydrates responses.
 *
 * @example
 * ```typescript
 * const proxy = await createRehydraProxyServer({
 *   port: 8080,
 *   upstream: 'https://api.openai.com',
 *   keyProvider: new ConfigKeyProvider(process.env.PII_KEY!),
 *   piiStorageProvider: new SQLitePIIStorageProvider('proxy.db'),
 * });
 *
 * console.log(`Proxy running on http://${proxy.host}:${proxy.port}`);
 *
 * // Point your OpenAI client at the proxy:
 * const openai = new OpenAI({ baseURL: `http://localhost:${proxy.port}/v1` });
 *
 * // Stop the server
 * await proxy.close();
 * ```
 */
export async function createRehydraProxyServer(
  config: RehydraProxyServerConfig,
): Promise<RehydraProxyServer> {
  const host = config.host ?? "127.0.0.1";
  const proxy = createRehydraProxy(config);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async (): Promise<void> => {
      try {
        const webRequest = incomingMessageToRequest(req, host, config.port);
        const webResponse = await proxy(webRequest);
        await writeResponse(res, webResponse);
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "proxy_error",
          message: error instanceof Error ? error.message : "Unknown proxy error",
        }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port, host, () => {
      resolve();
    });
  });

  return {
    server,
    port: config.port,
    host,
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined) reject(err);
          else resolve();
        });
      });
    },
  };
}

/**
 * Convert a Node.js IncomingMessage to a Web API Request
 */
function incomingMessageToRequest(
  req: IncomingMessage,
  host: string,
  port: number,
): Request {
  const url = `http://${host}:${port}${req.url ?? "/"}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? nodeStreamToReadableStream(req) : undefined,
    // @ts-expect-error - duplex is needed for streaming request bodies
    duplex: hasBody ? "half" : undefined,
  });
}

/**
 * Convert a Node.js Readable stream to a Web API ReadableStream
 */
function nodeStreamToReadableStream(nodeStream: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller): void {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err: Error) => {
        controller.error(err);
      });
    },
  });
}

/**
 * Write a Web API Response to a Node.js ServerResponse
 */
async function writeResponse(
  res: ServerResponse,
  webResponse: Response,
): Promise<void> {
  // Copy status and headers
  const headers: Record<string, string> = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(webResponse.status, headers);

  if (webResponse.body === null) {
    res.end();
    return;
  }

  // Stream the response body
  const reader = webResponse.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}
