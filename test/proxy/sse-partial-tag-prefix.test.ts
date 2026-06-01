import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRehydraFetch } from "../../src/proxy/rehydra-fetch.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";

function createCustomMockServer(
  handler: (body: Record<string, unknown>, res: ServerResponse) => void,
): Promise<{ server: Server; port: number; receivedBodies: unknown[] }> {
  return new Promise((resolve) => {
    const receivedBodies: unknown[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      receivedBodies.push(body);
      handler(body, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port, receivedBodies });
    });
  });
}

/**
 * Regression tests for partial PII tag-prefix splits across SSE chunk
 * boundaries. When an SSE chunk ends inside the tag prefix itself (e.g. "<P"
 * or "<PI" for the default "<PII" prefix), the partial must be buffered rather
 * than forwarded raw — otherwise the placeholder leaks to the client
 * unrehydrated and is never resolved.
 */
describe("SSE partial tag-prefix buffering", () => {
  let mockServer: { server: Server; port: number; receivedBodies: unknown[] } | null = null;
  afterEach(async () => {
    if (mockServer !== null) {
      await new Promise<void>((resolve) => mockServer!.server.close(() => resolve()));
      mockServer = null;
    }
  });

  // Split the content stream INSIDE the "<PII" prefix at each offset 1,2,3.
  for (const splitAfter of [1, 2, 3]) {
    it(`rehydrates when content chunk splits inside <PII prefix at offset ${splitAfter}`, async () => {
      mockServer = await createCustomMockServer((body, res) => {
        const prompt = ((body.messages as any[]) ?? []).find((m: any) => m.role === "user")?.content ?? "";
        // The anonymized prompt contains a full <PII .../> tag. Echo it back as content.
        const content = `Echo: ${prompt}`;
        const piiStart = content.indexOf("<PII");
        const splitPoint = piiStart + splitAfter; // split INSIDE the prefix
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, splitPoint) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(splitPoint) } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      const { port } = mockServer;

      const rehydraFetch = createRehydraFetch({
        keyProvider: new InMemoryKeyProvider(),
        piiStorageProvider: new InMemoryPIIStorageProvider(),
        provider: "openai",
        getSessionId: async () => `issue71-${splitAfter}`,
      });

      const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test",
          stream: true,
          messages: [{ role: "user", content: "Email john@example.com" }],
        }),
      });

      const fullStream = await response.text();

      // The raw PII tag must NOT leak to the client, and the real email must be restored.
      expect(fullStream).not.toContain("<PII");
      expect(fullStream).toContain("john@example.com");
    });
  }

  // Custom bracket tag format "[[PII" (length 5). Split inside the prefix at
  // each offset 1..4 to exercise the longest partial (offset 4 => "[[PI").
  for (const splitAfter of [1, 2, 3, 4]) {
    it(`rehydrates custom [[PII prefix split at offset ${splitAfter}`, async () => {
      const tagFormat = { open: "[[", close: "]]", keyword: "PII" };
      mockServer = await createCustomMockServer((body, res) => {
        const prompt = ((body.messages as any[]) ?? []).find((m: any) => m.role === "user")?.content ?? "";
        const content = `Echo: ${prompt}`;
        const piiStart = content.indexOf("[[PII");
        const splitPoint = piiStart + splitAfter;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, splitPoint) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(splitPoint) } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      const { port } = mockServer;

      const rehydraFetch = createRehydraFetch({
        keyProvider: new InMemoryKeyProvider(),
        piiStorageProvider: new InMemoryPIIStorageProvider(),
        provider: "openai",
        anonymizer: { tagFormat },
        getSessionId: async () => `issue71-bracket-${splitAfter}`,
      });

      const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test",
          stream: true,
          messages: [{ role: "user", content: "Email john@example.com" }],
        }),
      });

      const fullStream = await response.text();
      expect(fullStream).not.toContain("[[PII");
      expect(fullStream).toContain("john@example.com");
    });
  }
});
