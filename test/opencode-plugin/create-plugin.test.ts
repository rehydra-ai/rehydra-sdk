import { describe, it, expect, afterEach } from "vitest";
import { createRehydraPlugin, RehydraAnthropicPlugin, RehydraOpenAIPlugin } from "../../src/opencode-plugin/index.js";
import { readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a POST+JSON fetch init with the given body */
function jsonPost(body: unknown, headers?: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/** Create a valid SSE data line from an object */
function sseLine(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}`;
}

/** Create a mock SSE response (no Content-Type, like OpenAI Responses API) */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Read all text from a streaming Response body */
async function readStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

/** Create a unique temp dir for log file tests */
function makeTempDir(): string {
  const dir = join(tmpdir(), `rehydra-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The secret value we'll use in tests — must be ≥8 chars (minValueLength default)
const SECRET = "sk-TESTSECRET1234";

// ---------------------------------------------------------------------------
// Basic plugin structure
// ---------------------------------------------------------------------------

describe("createRehydraPlugin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should create a plugin function", () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    expect(typeof plugin).toBe("function");
  });

  it("should patch globalThis.fetch when called", () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const before = globalThis.fetch;
    plugin({ directory: "/tmp/test-project" });
    expect(globalThis.fetch).not.toBe(before);
  });

  it("should pass through non-POST requests to original fetch", async () => {
    const mockFetch = async (): Promise<Response> => new Response("ok");
    globalThis.fetch = mockFetch as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic" });
    plugin({ directory: "/tmp/test-project" });

    const response = await globalThis.fetch("https://example.com");
    expect(await response.text()).toBe("ok");
  });

  it("should return empty hooks object", () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const hooks = plugin({ directory: "/tmp/test-project" });
    expect(hooks).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Pre-configured plugins
// ---------------------------------------------------------------------------

describe("pre-configured plugins", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("RehydraAnthropicPlugin should be a function", () => {
    expect(typeof RehydraAnthropicPlugin).toBe("function");
  });

  it("RehydraOpenAIPlugin should be a function", () => {
    expect(typeof RehydraOpenAIPlugin).toBe("function");
  });

  it("RehydraAnthropicPlugin should patch fetch", () => {
    const before = globalThis.fetch;
    RehydraAnthropicPlugin({ directory: "/tmp/test" });
    expect(globalThis.fetch).not.toBe(before);
  });

  it("RehydraOpenAIPlugin should patch fetch", () => {
    const before = globalThis.fetch;
    RehydraOpenAIPlugin({ directory: "/tmp/test" });
    expect(globalThis.fetch).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Fetch interception — pass-through paths
// ---------------------------------------------------------------------------

describe("fetch interception — pass-through", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function setup(): void {
    globalThis.fetch = (async () => new Response("passthrough")) as typeof fetch;
    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });
  }

  it("passes through POST without string body", async () => {
    setup();
    const res = await globalThis.fetch("https://api.openai.com/v1/chat", {
      method: "POST",
      body: new FormData(),
    } as RequestInit);
    expect(await res.text()).toBe("passthrough");
  });

  it("passes through POST with non-JSON content-type", async () => {
    setup();
    const res = await globalThis.fetch("https://api.openai.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(await res.text()).toBe("passthrough");
  });

  it("passes through POST with invalid JSON body", async () => {
    setup();
    const res = await globalThis.fetch("https://api.openai.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    expect(await res.text()).toBe("passthrough");
  });

  it("passes through POST with null JSON body", async () => {
    setup();
    const res = await globalThis.fetch("https://api.openai.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(await res.text()).toBe("passthrough");
  });

  it("passes through when no texts are extracted", async () => {
    setup();
    const res = await globalThis.fetch("https://api.openai.com/v1/chat",
      jsonPost({ model: "gpt-4", messages: [] }));
    expect(await res.text()).toBe("passthrough");
  });

  it("extracts content-type from Headers object", async () => {
    setup();
    const headers = new Headers({ "content-type": "application/json" });
    const res = await globalThis.fetch("https://api.openai.com/v1/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });
    expect(await res.text()).toBe("passthrough");
  });
});

// ---------------------------------------------------------------------------
// Anonymization + response rehydration
// ---------------------------------------------------------------------------

describe("anonymization and rehydration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("pseudonymizes secrets in outbound Anthropic requests", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    await globalThis.fetch("https://api.anthropic.com/v1/messages",
      jsonPost({
        model: "claude-3",
        messages: [{ role: "user", content: `Use key ${SECRET} please` }],
      }));

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toContain(SECRET);
    expect(capturedBody).toContain("<PII");
  });

  it("pseudonymizes secrets in outbound OpenAI Responses API requests", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    await globalThis.fetch("https://api.openai.com/v1/responses",
      jsonPost({
        model: "gpt-4",
        input: [{ role: "user", content: `Deploy with ${SECRET}` }],
        instructions: "You are a helpful assistant.",
        stream: false,
      }));

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toContain(SECRET);
    expect(capturedBody).toContain("<PII");
    expect(capturedBody).toContain("<rehydra>");
  });

  it("does not inject rehydra instruction when no entities found", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    await globalThis.fetch("https://api.openai.com/v1/responses",
      jsonPost({
        model: "gpt-4",
        input: [{ role: "user", content: "Hello, no secrets here" }],
        instructions: "You are a helpful assistant.",
        stream: false,
      }));

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toContain("<rehydra>");
  });

  it("returns non-JSON, non-SSE response as-is", async () => {
    globalThis.fetch = (async () =>
      new Response("plain text", { headers: { "content-type": "text/plain" } })
    ) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.openai.com/v1/chat",
      jsonPost({
        model: "gpt-4",
        messages: [{ role: "user", content: `key: ${SECRET}` }],
      }));

    expect(await res.text()).toBe("plain text");
  });

  it("detects streaming when Content-Type is null and stream:true", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        sseLine({ type: "response.output_text.delta", delta: "Hello" }),
        "data: [DONE]",
      ])
    ) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.openai.com/v1/responses",
      jsonPost({
        model: "gpt-4",
        input: [{ role: "user", content: `key: ${SECRET}` }],
        stream: true,
      }));

    const text = await readStream(res);
    expect(text).toContain("Hello");
    expect(text).toContain("[DONE]");
  });
});

// ---------------------------------------------------------------------------
// SSE streaming rehydration
// ---------------------------------------------------------------------------

describe("SSE streaming rehydration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function sendWithSSE(lines: string[]): Promise<string> {
    globalThis.fetch = (async () => sseResponse(lines)) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "openai", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.openai.com/v1/responses",
      jsonPost({
        model: "gpt-4",
        input: [{ role: "user", content: `Use ${SECRET}` }],
        stream: true,
      }));

    return readStream(res);
  }

  it("passes through non-data lines", async () => {
    const text = await sendWithSSE([
      ": comment",
      sseLine({ type: "response.output_text.delta", delta: "hi" }),
    ]);
    expect(text).toContain(": comment");
  });

  it("passes through [DONE] sentinel", async () => {
    const text = await sendWithSSE(["data: [DONE]"]);
    expect(text).toContain("[DONE]");
  });

  it("passes through non-text SSE events without PII", async () => {
    const text = await sendWithSSE([
      sseLine({ type: "response.created", id: "resp_123" }),
    ]);
    expect(text).toContain("response.created");
  });

  it("rehydrates text deltas containing PII tags", async () => {
    const tag = '<PII type="ENV_VAR_SECRET" id="1"/>';
    const text = await sendWithSSE([
      sseLine({ type: "response.output_text.delta", delta: `Your key is ${tag}` }),
    ]);
    expect(text).toContain(SECRET);
    expect(text).not.toContain("ENV_VAR_SECRET");
  });

  it("buffers incomplete PII tags across text deltas", async () => {
    const text = await sendWithSSE([
      sseLine({ type: "response.output_text.delta", delta: "Key: <PII" }),
      sseLine({ type: "response.output_text.delta", delta: ' type="ENV_VAR_SECRET" id="1"/>' }),
    ]);
    expect(text).toContain(SECRET);
  });

  it("rehydrates tool call argument deltas with JSON-escaped tags", async () => {
    // The PII tag inside JSON function call args has escaped quotes
    const text = await sendWithSSE([
      sseLine({ type: "response.function_call_arguments.delta", delta: '{"command":"echo ' }),
      sseLine({ type: "response.function_call_arguments.delta", delta: '<PII type=\\"ENV_VAR_SECRET\\" id=\\"1\\"/>' }),
      sseLine({ type: "response.function_call_arguments.delta", delta: '"}' }),
      sseLine({ type: "response.function_call_arguments.done", arguments: '{"command":"echo <PII type=\\"ENV_VAR_SECRET\\" id=\\"1\\"/>"}' }),
    ]);
    expect(text).toContain(SECRET);
  });

  it("flushes tool call buffer on done event", async () => {
    const text = await sendWithSSE([
      sseLine({ type: "response.function_call_arguments.delta", delta: '{"cmd":"<PII' }),
      sseLine({ type: "response.function_call_arguments.done", arguments: "done" }),
    ]);
    // Buffer should have been flushed
    expect(text).toContain("response.function_call_arguments");
  });

  it("handles malformed JSON in SSE data gracefully", async () => {
    const text = await sendWithSSE([
      "data: not valid json",
      sseLine({ type: "response.output_text.delta", delta: "ok" }),
    ]);
    expect(text).toContain("not valid json");
    expect(text).toContain("ok");
  });

  it("deep-rehydrates non-text events with PII tags", async () => {
    const tag = '<PII type="ENV_VAR_SECRET" id="1"/>';
    const text = await sendWithSSE([
      sseLine({ type: "response.output_item.done", content: `value: ${tag}` }),
    ]);
    expect(text).toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// Anthropic SSE streaming rehydration
// ---------------------------------------------------------------------------

describe("Anthropic SSE streaming rehydration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** SSE response with Content-Type: text/event-stream (like Anthropic) */
  function anthropicSSEResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  async function sendAnthropicSSE(lines: string[]): Promise<string> {
    globalThis.fetch = (async () => anthropicSSEResponse(lines)) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.anthropic.com/v1/messages",
      jsonPost({
        model: "claude-3",
        messages: [{ role: "user", content: `Use ${SECRET}` }],
        stream: true,
      }));

    return readStream(res);
  }

  it("rehydrates Anthropic text_delta containing PII tags", async () => {
    const tag = '<PII type="ENV_VAR_SECRET" id="1"/>';
    const text = await sendAnthropicSSE([
      sseLine({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `Your key is ${tag}` } }),
    ]);
    expect(text).toContain(SECRET);
    expect(text).not.toContain("ENV_VAR_SECRET");
  });

  it("rehydrates PII tags split across Anthropic text deltas", async () => {
    const text = await sendAnthropicSSE([
      sseLine({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Key: <PII" } }),
      sseLine({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ' type="ENV_VAR_SECRET" id="1"/>' } }),
    ]);
    expect(text).toContain(SECRET);
  });

  it("passes through Anthropic non-delta events", async () => {
    const text = await sendAnthropicSSE([
      sseLine({ type: "message_start", message: { id: "msg_1" } }),
      sseLine({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sseLine({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      sseLine({ type: "content_block_stop", index: 0 }),
      sseLine({ type: "message_stop" }),
    ]);
    expect(text).toContain("message_start");
    expect(text).toContain("Hello");
    expect(text).toContain("content_block_stop");
  });

  it("rehydrates Anthropic tool use input_json_delta", async () => {
    const text = await sendAnthropicSSE([
      sseLine({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"cmd":"echo ' } }),
      sseLine({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '<PII type=\\"ENV_VAR_SECRET\\" id=\\"1\\"/>' } }),
      sseLine({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"}' } }),
      sseLine({ type: "content_block_stop", index: 1 }),
    ]);
    expect(text).toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// SSE chunk splitting (data lines split across TCP segments)
// ---------------------------------------------------------------------------

describe("SSE chunk splitting", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** SSE response that delivers data as multiple separate chunks */
  function multiChunkSSEResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  it("handles Anthropic data line split across two chunks", async () => {
    // Simulate a TCP segment boundary splitting a data line mid-JSON
    const fullLine = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: '<PII type="ENV_VAR_SECRET" id="1"/>' },
    });
    const splitAt = Math.floor(fullLine.length / 2);

    globalThis.fetch = (async () => multiChunkSSEResponse([
      `data: ${fullLine.slice(0, splitAt)}`,
      `${fullLine.slice(splitAt)}\n\n`,
    ])) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.anthropic.com/v1/messages",
      jsonPost({
        model: "claude-3",
        messages: [{ role: "user", content: `Use ${SECRET}` }],
        stream: true,
      }));

    const text = await readStream(res);
    expect(text).toContain(SECRET);
    expect(text).not.toContain("ENV_VAR_SECRET");
  });

  it("handles multiple complete events across chunks", async () => {
    const event1 = `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })}\n`;
    const event2 = `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } })}\n`;

    globalThis.fetch = (async () => multiChunkSSEResponse([
      event1,
      event2,
    ])) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.anthropic.com/v1/messages",
      jsonPost({
        model: "claude-3",
        messages: [{ role: "user", content: `Use ${SECRET}` }],
        stream: true,
      }));

    const text = await readStream(res);
    expect(text).toContain("Hello ");
    expect(text).toContain("world");
  });

  it("handles data line split across three chunks", async () => {
    const fullLine = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: '<PII type="ENV_VAR_SECRET" id="1"/> is the key' },
    });
    const third = Math.floor(fullLine.length / 3);

    globalThis.fetch = (async () => multiChunkSSEResponse([
      `data: ${fullLine.slice(0, third)}`,
      fullLine.slice(third, third * 2),
      `${fullLine.slice(third * 2)}\n\n`,
    ])) as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic", redactValues: [SECRET] });
    plugin({ directory: "/tmp/test" });

    const res = await globalThis.fetch("https://api.anthropic.com/v1/messages",
      jsonPost({
        model: "claude-3",
        messages: [{ role: "user", content: `Use ${SECRET}` }],
        stream: true,
      }));

    const text = await readStream(res);
    expect(text).toContain(SECRET);
    expect(text).not.toContain("ENV_VAR_SECRET");
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe("logging", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function sendRequest(logLevel: "normal" | "debug" | false, logFile: string): Promise<void> {
    globalThis.fetch = (async () =>
      new Response("{}", { headers: { "content-type": "application/json" } })
    ) as typeof fetch;

    const plugin = createRehydraPlugin({
      provider: "openai",
      redactValues: [SECRET],
      log: logLevel !== false ? { level: logLevel, file: logFile } : false,
    });
    plugin({ directory: "/tmp/test" });

    await globalThis.fetch("https://api.openai.com/v1/chat",
      jsonPost({
        model: "gpt-4",
        messages: [{ role: "user", content: `key: ${SECRET}` }],
      }));
  }

  it("writes normal log with scrubbed PII types", async () => {
    const dir = makeTempDir();
    const logFile = join(dir, "normal.log");

    await sendRequest("normal", logFile);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("scrubbed");
    expect(content).toContain("ENV_VAR_SECRET");
    unlinkSync(logFile);
  });

  it("does not write debug logs at normal level", async () => {
    const dir = makeTempDir();
    const logFile = join(dir, "normal-only.log");

    await sendRequest("normal", logFile);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("scrubbed");
    expect(content).not.toContain("diffs");
    expect(content).not.toContain("textsExtracted");
    unlinkSync(logFile);
  });

  it("writes both normal and debug logs at debug level", async () => {
    const dir = makeTempDir();
    const logFile = join(dir, "debug.log");

    await sendRequest("debug", logFile);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("scrubbed");
    expect(content).toContain("diffs");
    expect(content).toContain("textsExtracted");
    unlinkSync(logFile);
  });

  it("does not create log file when log is false", async () => {
    const dir = makeTempDir();
    const logFile = join(dir, "should-not-exist.log");

    await sendRequest(false, logFile);

    expect(() => readFileSync(logFile, "utf-8")).toThrow();
  });
});
