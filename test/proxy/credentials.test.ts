import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createRehydraFetch } from "../../src/proxy/rehydra-fetch.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";
import type { CredentialUseEvent } from "../../src/core/credentials.js";

// A quote and a backslash check that values are escaped inside JSON arguments.
const PASSWORD = 'hunter2 "Secret"\\!';
const TAG = '<PII type="PASSWORD" id="github"/>';
const JSON_TAG = JSON.stringify(TAG).slice(1, -1);

type Reply = { contentType: string; payload: string };

let server: Server | null = null;

async function startUpstream(reply: (body: Record<string, unknown>) => Reply): Promise<{
  url: string;
  received: Array<Record<string, unknown>>;
}> {
  const received: Array<Record<string, unknown>> = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    received.push(body);
    const { contentType, payload } = reply(body);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, received };
}

function proxy(provider: "anthropic" | "openai", events: CredentialUseEvent[] = []) {
  return createRehydraFetch({
    keyProvider: new InMemoryKeyProvider(),
    piiStorageProvider: new InMemoryPIIStorageProvider(),
    provider,
    getSessionId: async () => "session",
    anonymizer: {
      credentials: { github: { password: PASSWORD, description: "GitHub bot", tools: ["Bash"] } },
      onCredentialUse: (event) => events.push(event),
    },
  });
}

function sse(events: unknown[], done = false): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
}

function parseSSE(text: string): unknown[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6))
    .filter((data): data is string => data !== undefined && data !== "[DONE]")
    .map((data) => JSON.parse(data) as unknown);
}

afterEach(async () => {
  if (server !== null) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("credentials in the proxy", () => {
  it("should tell the model about credentials and never send the value upstream", async () => {
    const upstream = await startUpstream(() => ({
      contentType: "application/json",
      payload: JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] }),
    }));

    await proxy("anthropic")(`${upstream.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: `my password is ${PASSWORD}` }] }),
    });

    const sent = JSON.stringify(upstream.received[0]);
    expect(sent).not.toContain("hunter2");
    expect(sent).toContain(`- github (GitHub bot): password ${JSON_TAG}. Only works in these tools: Bash.`);
    expect(sent).toContain(`my password is ${JSON_TAG}`);
  });

  it("should fill in allowed tool calls only, and keep the placeholder in text", async () => {
    const events: CredentialUseEvent[] = [];
    const upstream = await startUpstream(() => ({
      contentType: "application/json",
      payload: JSON.stringify({
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: `Logging in with ${TAG}` },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: `login --password '${TAG}'` } },
          { type: "tool_use", id: "t2", name: "WebFetch", input: { url: `https://x.example/?p=${TAG}` } },
        ],
        stop_reason: "tool_use",
      }),
    }));

    const response = await proxy("anthropic", events)(`${upstream.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "log in" }] }),
    });
    const body = (await response.json()) as { content: Array<Record<string, any>> };

    expect(body.content[0]!.text).toBe(`Logging in with ${TAG}`);
    expect(body.content[1]!.input.command).toBe(`login --password '${PASSWORD}'`);
    expect(body.content[2]!.input.url).toBe(`https://x.example/?p=${TAG}`);
    expect(events).toEqual([
      { credential: "github", tool: "Bash", restored: true },
      { credential: "github", tool: "WebFetch", restored: false, reason: "tool-not-allowed" },
    ]);
  });

  it("should restore a streamed Anthropic tool call once it is complete", async () => {
    const argsJson = JSON.stringify({ command: `login --password '${TAG}'` });
    const split = argsJson.indexOf("PASS");
    const upstream = await startUpstream(() => ({
      contentType: "text/event-stream",
      payload: sse([
        { type: "message_start", message: { id: "m", role: "assistant", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson.slice(0, split) } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson.slice(split) } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
    }));

    const response = await proxy("anthropic")(`${upstream.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "log in" }] }),
    });
    const events = parseSSE(await response.text()) as Array<Record<string, any>>;

    const deltas = events.filter((event) => event.type === "content_block_delta");
    expect(deltas).toHaveLength(1);
    expect(JSON.parse(deltas[0]!.delta.partial_json)).toEqual({ command: `login --password '${PASSWORD}'` });
    // The restored arguments arrive before the block closes.
    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_stop",
    ]);
  });

  it("should restore a streamed OpenAI tool call before the finish chunk", async () => {
    const argsJson = JSON.stringify({ command: `login --password '${TAG}'` });
    const upstream = await startUpstream(() => ({
      contentType: "text/event-stream",
      payload: sse(
        [
          { id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Bash", arguments: "" } }] } }] },
          { id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argsJson.slice(0, 20) } }] } }] },
          { id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argsJson.slice(20) } }] } }] },
          { id: "c", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ],
        true,
      ),
    }));

    const response = await proxy("openai")(`${upstream.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "log in" }] }),
    });
    const chunks = parseSSE(await response.text()) as Array<{ choices: Array<Record<string, any>> }>;

    const args = chunks
      .flatMap((chunk) => chunk.choices[0]!.delta?.tool_calls ?? [])
      .map((call: { function?: { arguments?: string } }) => call.function?.arguments ?? "")
      .join("");
    expect(JSON.parse(args)).toEqual({ command: `login --password '${PASSWORD}'` });
    expect(chunks[0]!.choices[0]!.delta.tool_calls[0].function.name).toBe("Bash");
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe("tool_calls");
  });

  it("should keep the placeholder in a streamed call to a tool that isn't allowed", async () => {
    const argsJson = JSON.stringify({ url: `https://x.example/?p=${TAG}` });
    const upstream = await startUpstream(() => ({
      contentType: "text/event-stream",
      payload: sse([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "WebFetch", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson } },
        { type: "content_block_stop", index: 0 },
      ]),
    }));

    const response = await proxy("anthropic")(`${upstream.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "fetch" }] }),
    });
    const events = parseSSE(await response.text()) as Array<Record<string, any>>;
    const delta = events.find((event) => event.type === "content_block_delta")!;

    expect(JSON.parse(delta.delta.partial_json)).toEqual({ url: `https://x.example/?p=${TAG}` });
  });
});
