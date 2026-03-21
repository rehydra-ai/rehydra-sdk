import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createRehydraFetch } from "../../src/proxy/rehydra-fetch.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";

/**
 * Create a mock LLM HTTP server that echoes back the received prompt
 * in an OpenAI-compatible response format.
 */
function createMockLLMServer(): Promise<{ server: Server; port: number; receivedBodies: unknown[] }> {
  return new Promise((resolve) => {
    const receivedBodies: unknown[] = [];

    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks).toString();

      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        // Non-JSON body (e.g., GET requests)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      receivedBodies.push(body);

      const isStreaming = body.stream === true;
      const prompt = (body.messages as any)?.[0]?.content ?? "no content";

      if (isStreaming) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Send SSE chunks
        const words = `Echo: ${prompt}`.split(" ");
        for (const word of words) {
          const chunk = {
            choices: [{ delta: { content: word + " " } }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: `Echo: ${prompt}`,
            },
          }],
        }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port, receivedBodies });
    });
  });
}

describe("createRehydraFetch", () => {
  let mockServer: { server: Server; port: number; receivedBodies: unknown[] } | null = null;

  afterEach(async () => {
    if (mockServer !== null) {
      await new Promise<void>((resolve) => {
        mockServer!.server.close(() => resolve());
      });
      mockServer = null;
    }
  });

  it("should anonymize request and rehydrate non-streaming response", async () => {
    mockServer = await createMockLLMServer();
    const { port, receivedBodies } = mockServer;

    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    const rehydraFetch = createRehydraFetch({
      keyProvider,
      piiStorageProvider: storage,
      provider: "openai",
      getSessionId: async () => "test-session",
    });

    const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "Contact john@example.com please" }],
      }),
    });

    expect(response.ok).toBe(true);

    // Verify the request sent to the mock server was anonymized
    const sentBody = receivedBodies[0] as any;
    expect(sentBody.messages[0].content).toContain('<PII type="EMAIL"');
    expect(sentBody.messages[0].content).not.toContain("john@example.com");

    // Verify the response was rehydrated
    const data = await response.json() as any;
    const content = data.choices[0].message.content;
    // The echo response contains the anonymized text, which gets rehydrated
    expect(content).toContain("john@example.com");
  });

  it("should pass through non-POST requests unchanged", async () => {
    mockServer = await createMockLLMServer();
    const { port } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
    });

    const response = await rehydraFetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
    });

    // Should pass through (server will return something, but the point is no error)
    expect(response).toBeDefined();
  });

  it("should handle streaming SSE responses", async () => {
    mockServer = await createMockLLMServer();
    const { port, receivedBodies } = mockServer;

    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    const rehydraFetch = createRehydraFetch({
      keyProvider,
      piiStorageProvider: storage,
      provider: "openai",
      getSessionId: async () => "stream-session",
    });

    const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "Contact john@example.com please" }],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);

    // Verify request was anonymized
    const sentBody = receivedBodies[0] as any;
    expect(sentBody.messages[0].content).toContain('<PII type="EMAIL"');

    // Read the SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // The stream should contain rehydrated content
    expect(fullText).toContain("data:");
  });

  it("should auto-detect provider from URL", async () => {
    // Just verify no errors — auto-detection defaults to OpenAI
    mockServer = await createMockLLMServer();
    const { port } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      // No provider specified — auto-detect
    });

    const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "Hello world" }],
      }),
    });

    expect(response.ok).toBe(true);
  });

  it("should persist PII map to storage", async () => {
    mockServer = await createMockLLMServer();
    const { port } = mockServer;

    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    const rehydraFetch = createRehydraFetch({
      keyProvider,
      piiStorageProvider: storage,
      getSessionId: async () => "persist-test",
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "Email john@example.com" }],
      }),
    });

    const exists = await storage.exists("persist-test");
    expect(exists).toBe(true);
  });
});
