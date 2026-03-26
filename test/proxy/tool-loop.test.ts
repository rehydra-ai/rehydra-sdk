/**
 * Tests for multi-round tool execution loop (onToolCall hook)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRehydraFetch } from "../../src/proxy/rehydra-fetch.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";

/** Parsed request body received by the mock server */
interface ReceivedBody {
  messages: Array<{
    role: string;
    content: string | null | unknown[];
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  stream?: boolean;
  [key: string]: unknown;
}

type ResponseHandler = (body: ReceivedBody, callIndex: number) => unknown;

/**
 * Create a mock LLM HTTP server with a custom response handler.
 * The handler receives each request body and returns the JSON response.
 */
function createMockServer(
  handler: ResponseHandler,
): Promise<{ server: Server; port: number; receivedBodies: ReceivedBody[] }> {
  return new Promise((resolve) => {
    const receivedBodies: ReceivedBody[] = [];
    let callIndex = 0;

    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const rawBody = Buffer.concat(chunks).toString();

        let body: ReceivedBody;
        try {
          body = JSON.parse(rawBody) as ReceivedBody;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
        receivedBodies.push(body);

        const responseBody = handler(body, callIndex++);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseBody));
      },
    );

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port, receivedBodies });
    });
  });
}

/** OpenAI tool call response shape */
function toolCallResponse(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      },
    ],
  };
}

/** OpenAI final text response shape */
function textResponse(content: string) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
        },
      },
    ],
  };
}

describe("Tool execution loop (onToolCall)", () => {
  let mockServer: {
    server: Server;
    port: number;
    receivedBodies: ReceivedBody[];
  } | null = null;

  afterEach(async () => {
    if (mockServer !== null) {
      await new Promise<void>((resolve) => {
        mockServer!.server.close(() => resolve());
      });
      mockServer = null;
    }
  });

  it("should execute a single tool call round", async () => {
    // Round 1: LLM returns a tool call with anonymized args
    // Round 2: LLM returns a final text response
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        // First call: return a tool call
        // The email is anonymized in the request, so the LLM echoes a PII tag
        const userContent = body.messages[0]?.content as string;
        const emailTag =
          userContent.match(/<PII[^/]*\/>/)?.[0] ?? "unknown@email.com";
        return toolCallResponse([
          {
            id: "call_1",
            name: "lookup_user",
            arguments: JSON.stringify({ email: emailTag }),
          },
        ]);
      }
      // Second call: return final response
      return textResponse("Done! User found.");
    });

    const { port, receivedBodies } = mockServer;
    const toolCallLog: Array<{
      name: string;
      args: Record<string, unknown>;
    }> = [];

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "tool-test-1",
      onToolCall: async (name, args, toolCallId) => {
        toolCallLog.push({ name, args });
        return { id: "user-42", name: "John Smith" };
      },
      maxToolRounds: 5,
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            {
              role: "user",
              content: "Look up the user john@example.com",
            },
          ],
        }),
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { choices: Array<{ message: { content: string } }> };

    // Final response should be rehydrated
    expect(result.choices[0].message.content).toBe("Done! User found.");

    // onToolCall should have been called with rehydrated args
    expect(toolCallLog).toHaveLength(1);
    expect(toolCallLog[0].name).toBe("lookup_user");
    expect(toolCallLog[0].args.email).toBe("john@example.com");

    // Server should have received 2 requests
    expect(receivedBodies).toHaveLength(2);

    // Second request should have tool result messages
    const secondBody = receivedBodies[1]!;
    expect(secondBody.messages).toHaveLength(3); // user + assistant + tool
    expect(secondBody.messages[1].role).toBe("assistant");
    expect(secondBody.messages[1].tool_calls).toHaveLength(1);
    expect(secondBody.messages[2].role).toBe("tool");
    expect(secondBody.messages[2].tool_call_id).toBe("call_1");
  });

  it("should handle multi-round tool calls", async () => {
    let callCount = 0;
    mockServer = await createMockServer((body, callIndex) => {
      callCount++;
      if (callIndex < 2) {
        return toolCallResponse([
          {
            id: `call_${callIndex + 1}`,
            name: `tool_${callIndex + 1}`,
            arguments: JSON.stringify({ step: callIndex + 1 }),
          },
        ]);
      }
      return textResponse("All steps done");
    });

    const { port } = mockServer;
    const calls: string[] = [];

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "multi-round",
      onToolCall: async (name) => {
        calls.push(name);
        return { ok: true };
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Do the multi-step task" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(result.choices[0].message.content).toBe("All steps done");
    expect(calls).toEqual(["tool_1", "tool_2"]);
    expect(callCount).toBe(3);
  });

  it("should handle multiple parallel tool calls in one response", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          {
            id: "call_a",
            name: "get_weather",
            arguments: JSON.stringify({ city: "Berlin" }),
          },
          {
            id: "call_b",
            name: "get_time",
            arguments: JSON.stringify({ timezone: "CET" }),
          },
        ]);
      }
      return textResponse("Weather is sunny, time is 3pm");
    });

    const { port, receivedBodies } = mockServer;
    const calls: Array<{ name: string; id: string }> = [];

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "parallel-tools",
      onToolCall: async (name, args, toolCallId) => {
        calls.push({ name, id: toolCallId });
        return { result: `${name} result` };
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            { role: "user", content: "What's the weather and time?" },
          ],
        }),
      },
    );

    expect(response.ok).toBe(true);

    // Both tool calls should have been invoked
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("get_weather");
    expect(calls[0].id).toBe("call_a");
    expect(calls[1].name).toBe("get_time");
    expect(calls[1].id).toBe("call_b");

    // Second request should have both tool results
    const secondBody = receivedBodies[1]!;
    const toolMsgs = secondBody.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
  });

  it("should respect maxToolRounds limit", async () => {
    // Server always returns tool calls — would loop forever without limit
    mockServer = await createMockServer((body, callIndex) => {
      return toolCallResponse([
        {
          id: `call_${callIndex}`,
          name: "infinite_tool",
          arguments: "{}",
        },
      ]);
    });

    const { port, receivedBodies } = mockServer;
    let callbackCount = 0;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "max-rounds",
      onToolCall: async () => {
        callbackCount++;
        return { ok: true };
      },
      maxToolRounds: 3,
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Do something" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    // Should stop after 3 rounds (3 tool calls + 1 initial = 4 server requests)
    expect(callbackCount).toBe(3);
    expect(receivedBodies).toHaveLength(4);
  });

  it("should not re-anonymize already-anonymized messages across rounds", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        // Return a tool call — the user message should contain PII tags
        const userContent = body.messages[0]?.content as string;
        return toolCallResponse([
          {
            id: "call_1",
            name: "check",
            arguments: JSON.stringify({ input: userContent }),
          },
        ]);
      }
      // Round 2: verify messages are intact (not double-anonymized)
      return textResponse("OK");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "no-re-anon",
      onToolCall: async () => ({ result: "done" }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "user", content: "Contact john@example.com please" },
        ],
      }),
    });

    // First request: email should be anonymized
    const firstUserContent = receivedBodies[0]!.messages[0]!.content as string;
    expect(firstUserContent).toContain("<PII");
    expect(firstUserContent).not.toContain("john@example.com");

    // Second request: the same user message should have the SAME PII tag
    // (not double-anonymized like <<PII...>> or mangled)
    const secondUserContent = receivedBodies[1]!.messages[0]!
      .content as string;
    expect(secondUserContent).toBe(firstUserContent);
  });

  it("should anonymize PII in tool results", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          {
            id: "call_1",
            name: "get_profile",
            arguments: "{}",
          },
        ]);
      }
      return textResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "anon-result",
      onToolCall: async () => ({
        name: "Jane Doe",
        email: "jane@secret.com",
      }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Get profile" }],
      }),
    });

    // The tool result sent to the LLM should have anonymized PII
    const secondBody = receivedBodies[1]!;
    const toolResultContent = secondBody.messages[2]!.content as string;
    expect(toolResultContent).not.toContain("jane@secret.com");
    expect(toolResultContent).toContain("<PII");
  });

  it("should anonymize PII in assistant tool_call arguments", async () => {
    // Simulate the LLM hallucinating real PII in tool call arguments
    // instead of using PII tags (common model behavior)
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          {
            id: "call_1",
            name: "send_email",
            // LLM generated a real-looking email instead of echoing the PII tag
            arguments: JSON.stringify({
              to: "alice@realcompany.com",
              subject: "Meeting",
            }),
          },
        ]);
      }
      return textResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "anon-tool-args",
      onToolCall: async () => ({ sent: true }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "user", content: "Email alice@realcompany.com about the meeting" },
        ],
      }),
    });

    // The assistant message in the second request should have anonymized
    // tool_call arguments — no raw PII
    const secondBody = receivedBodies[1]!;
    const assistantMsg = secondBody.messages[1]!;
    expect(assistantMsg.role).toBe("assistant");
    const toolCallArgs = assistantMsg.tool_calls![0].function.arguments;
    expect(toolCallArgs).not.toContain("alice@realcompany.com");
    expect(toolCallArgs).toContain("PII");
  });

  it("should reuse PII IDs for the same value across tool results", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        // Extract the PII tag for the email from the user message
        const userContent = body.messages[0]?.content as string;
        const emailTag =
          userContent.match(/<PII[^/]*\/>/)?.[0] ?? "unknown";
        return toolCallResponse([
          {
            id: "call_1",
            name: "lookup",
            arguments: JSON.stringify({ email: emailTag }),
          },
        ]);
      }
      return textResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "id-reuse",
      onToolCall: async () => ({
        // Return the same email that was in the original message
        found_email: "john@example.com",
        status: "active",
      }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "Find user john@example.com",
          },
        ],
      }),
    });

    // Extract the email PII ID from the first request
    const firstUserContent = receivedBodies[0]!.messages[0]!.content as string;
    const idMatch = firstUserContent.match(/id="(\d+)"/);
    expect(idMatch).not.toBeNull();
    const emailId = idMatch![1];

    // The tool result should reuse the same PII ID for the same email
    // (content is JSON-stringified, so quotes are escaped)
    const toolResultContent = receivedBodies[1]!.messages[2]!
      .content as string;
    expect(toolResultContent).toContain(`id=\\"${emailId}\\"`);
    expect(toolResultContent).toContain('type=\\"EMAIL\\"');
  });

  it("should propagate errors from onToolCall", async () => {
    mockServer = await createMockServer(() => {
      return toolCallResponse([
        { id: "call_1", name: "fail_tool", arguments: "{}" },
      ]);
    });

    const { port } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "error-test",
      onToolCall: async () => {
        throw new Error("Tool execution failed");
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Trigger error" }],
        }),
      },
    );

    expect(response.status).toBe(500);
    const errorBody = (await response.json()) as { error: { message: string } };
    expect(errorBody.error.message).toContain("Tool execution failed");
  });

  it("should pass through when onToolCall is not set (existing behavior)", async () => {
    mockServer = await createMockServer(() => {
      return toolCallResponse([
        {
          id: "call_1",
          name: "some_tool",
          arguments: JSON.stringify({ key: "value" }),
        },
      ]);
    });

    const { port, receivedBodies } = mockServer;

    // No onToolCall configured — should return tool call response directly
    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "no-hook",
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as {
      choices: Array<{
        message: { tool_calls?: unknown[] };
      }>;
    };
    // Should return the tool call response as-is (rehydrated but not executed)
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    // Only one request should have been made (no loop)
    expect(receivedBodies).toHaveLength(1);
  });

  it("should return final response without tool calls when LLM gives immediate text", async () => {
    mockServer = await createMockServer(() => {
      return textResponse("Simple response, no tools needed");
    });

    const { port, receivedBodies } = mockServer;
    let toolCallCount = 0;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "no-tools",
      onToolCall: async () => {
        toolCallCount++;
        return {};
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Just a simple question" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(result.choices[0].message.content).toBe(
      "Simple response, no tools needed",
    );
    // onToolCall should never be called
    expect(toolCallCount).toBe(0);
    expect(receivedBodies).toHaveLength(1);
  });

  it("should set stream: false on subsequent round requests", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          { id: "call_1", name: "tool1", arguments: "{}" },
        ]);
      }
      return textResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "stream-false",
      onToolCall: async () => ({}),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        stream: true, // User requested streaming
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    // Second request should have stream: false (tool loop needs full JSON response)
    expect(receivedBodies[1]!.stream).toBe(false);
  });

  it("should handle invalid JSON in initial LLM response", async () => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not valid json{{{");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    mockServer = { server, port, receivedBodies: [] };

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "invalid-json-initial",
      onToolCall: async () => ({}),
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    // Should pass through the raw response
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("not valid json{{{");
  });

  it("should handle invalid JSON in tool call arguments", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          {
            id: "call_1",
            name: "my_tool",
            arguments: "not a json string!!!",
          },
        ]);
      }
      return textResponse("Done");
    });

    const { port } = mockServer;
    const receivedArgs: Record<string, unknown>[] = [];

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "invalid-tool-args",
      onToolCall: async (name, args) => {
        receivedArgs.push(args);
        return { ok: true };
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    // Should fall back to { raw: ... }
    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]).toHaveProperty("raw");
  });

  it("should handle onToolCall returning a string result", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return toolCallResponse([
          { id: "call_1", name: "my_tool", arguments: "{}" },
        ]);
      }
      return textResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "string-result",
      onToolCall: async () => "plain string result",
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    expect(response.ok).toBe(true);
    // The tool result content should be the string directly (not JSON.stringify'd)
    const toolMsg = receivedBodies[1]!.messages.find(
      (m) => m.role === "tool",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe("plain string result");
  });

  it("should handle upstream fetch failure during tool loop", async () => {
    let callCount = 0;
    mockServer = await createMockServer((body, callIndex) => {
      callCount++;
      // First call returns tool call
      return toolCallResponse([
        { id: "call_1", name: "my_tool", arguments: "{}" },
      ]);
    });

    const { port } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "fetch-fail",
      onToolCall: async () => {
        // Shut down the server after the first tool call so the next fetch fails
        await new Promise<void>((resolve) => {
          mockServer!.server.close(() => resolve());
        });
        return { ok: true };
      },
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    // Should return a 502 error
    expect(response.status).toBe(502);
    const errorBody = (await response.json()) as {
      error: { message: string };
    };
    expect(errorBody.error.message).toContain("Upstream LLM unreachable");
    // Prevent afterEach from trying to close an already-closed server
    mockServer = null;
  });

  it("should handle invalid JSON in subsequent LLM response", async () => {
    let callCount = 0;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      callCount++;

      res.writeHead(200, { "Content-Type": "application/json" });
      if (callCount === 1) {
        // First response: valid tool call
        res.end(
          JSON.stringify(
            toolCallResponse([
              { id: "call_1", name: "my_tool", arguments: "{}" },
            ]),
          ),
        );
      } else {
        // Second response: invalid JSON
        res.end("broken json response!!!");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    mockServer = { server, port, receivedBodies: [] };

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "openai",
      getSessionId: async () => "invalid-json-subsequent",
      onToolCall: async () => ({ ok: true }),
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    // Should pass through the raw invalid response
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("broken json response!!!");
  });
});

// ── Anthropic format tests ───────────────────────────────────────

/** Anthropic tool_use response shape */
function anthropicToolUseResponse(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    })),
    stop_reason: "tool_use",
  };
}

/** Anthropic final text response shape */
function anthropicTextResponse(text: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  };
}

describe("Tool execution loop — Anthropic format", () => {
  let mockServer: {
    server: Server;
    port: number;
    receivedBodies: ReceivedBody[];
  } | null = null;

  afterEach(async () => {
    if (mockServer !== null) {
      await new Promise<void>((resolve) => {
        mockServer!.server.close(() => resolve());
      });
      mockServer = null;
    }
  });

  it("should execute a single tool call round with Anthropic format", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        // Extract the PII tag from the anonymized user message
        const msgs = body.messages as Array<{ role: string; content: string }>;
        const userContent = msgs.find((m) => m.role === "user")?.content ?? "";
        const emailTag =
          userContent.match(/<PII[^/]*\/>/)?.[0] ?? "unknown@email.com";

        return anthropicToolUseResponse([
          {
            id: "toolu_01ABC",
            name: "lookup_user",
            input: { email: emailTag },
          },
        ]);
      }
      return anthropicTextResponse("Found the user!");
    });

    const { port, receivedBodies } = mockServer;
    const toolCallLog: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }> = [];

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "anthropic",
      getSessionId: async () => "anthropic-test-1",
      onToolCall: async (name, args, toolCallId) => {
        toolCallLog.push({ name, args, id: toolCallId });
        return { id: "user-42", name: "John Smith" };
      },
      maxToolRounds: 5,
    });

    const response = await rehydraFetch(
      `http://127.0.0.1:${port}/v1/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [
            {
              role: "user",
              content: "Look up the user john@example.com",
            },
          ],
        }),
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Final response text should be rehydrated
    expect(result.content[0].text).toBe("Found the user!");

    // onToolCall should have been called with rehydrated args
    expect(toolCallLog).toHaveLength(1);
    expect(toolCallLog[0].name).toBe("lookup_user");
    expect(toolCallLog[0].args.email).toBe("john@example.com");
    expect(toolCallLog[0].id).toBe("toolu_01ABC");

    // Server should have received 2 requests
    expect(receivedBodies).toHaveLength(2);

    // Second request should have Anthropic message format:
    // user message + assistant (with tool_use content) + user (with tool_result content)
    const secondBody = receivedBodies[1]! as Record<string, unknown>;
    const msgs = secondBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(msgs).toHaveLength(3);

    // First: original user message (already anonymized)
    expect(msgs[0].role).toBe("user");

    // Second: assistant with tool_use block
    expect(msgs[1].role).toBe("assistant");
    const assistantContent = msgs[1].content as Array<{
      type: string;
      id?: string;
    }>;
    expect(assistantContent[0].type).toBe("tool_use");
    expect(assistantContent[0].id).toBe("toolu_01ABC");

    // Third: user with tool_result block
    expect(msgs[2].role).toBe("user");
    const toolResultContent = msgs[2].content as Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
    }>;
    expect(toolResultContent[0].type).toBe("tool_result");
    expect(toolResultContent[0].tool_use_id).toBe("toolu_01ABC");
  });

  it("should anonymize PII in tool results with Anthropic format", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return anthropicToolUseResponse([
          { id: "toolu_01X", name: "get_contact", input: {} },
        ]);
      }
      return anthropicTextResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "anthropic",
      getSessionId: async () => "anthropic-anon-result",
      onToolCall: async () => ({
        name: "Jane Doe",
        email: "jane@secret.com",
      }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Get the contact info" }],
      }),
    });

    // The tool result sent to the LLM should have anonymized PII
    const secondBody = receivedBodies[1]! as Record<string, unknown>;
    const msgs = secondBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResultMsg = msgs[2]; // user message with tool_result
    const toolResultBlocks = toolResultMsg.content as Array<{
      content?: string;
    }>;
    const resultContent = toolResultBlocks[0].content!;
    expect(resultContent).not.toContain("jane@secret.com");
    expect(resultContent).toContain("PII");
  });

  it("should not re-anonymize messages across rounds with Anthropic format", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return anthropicToolUseResponse([
          { id: "toolu_01Y", name: "check", input: {} },
        ]);
      }
      return anthropicTextResponse("OK");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "anthropic",
      getSessionId: async () => "anthropic-no-re-anon",
      onToolCall: async () => ({ status: "done" }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "user", content: "Contact john@example.com please" },
        ],
      }),
    });

    // First request: email should be anonymized
    const firstMsgs = receivedBodies[0]!.messages;
    const firstUserContent = firstMsgs[0]!.content as string;
    expect(firstUserContent).toContain("<PII");
    expect(firstUserContent).not.toContain("john@example.com");

    // Second request: same user message should have identical PII tag
    const secondMsgs = (receivedBodies[1]! as Record<string, unknown>)
      .messages as Array<{ content: unknown }>;
    const secondUserContent = secondMsgs[0]!.content as string;
    expect(secondUserContent).toBe(firstUserContent);
  });

  it("should anonymize PII in assistant tool_use input with Anthropic format", async () => {
    mockServer = await createMockServer((body, callIndex) => {
      if (callIndex === 0) {
        return anthropicToolUseResponse([
          {
            id: "toolu_01Z",
            name: "send_email",
            // LLM hallucinated real PII in tool_use input
            input: { to: "alice@realcompany.com", subject: "Meeting" },
          },
        ]);
      }
      return anthropicTextResponse("Done");
    });

    const { port, receivedBodies } = mockServer;

    const rehydraFetch = createRehydraFetch({
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: "anthropic",
      getSessionId: async () => "anthropic-anon-tool-input",
      onToolCall: async () => ({ sent: true }),
    });

    await rehydraFetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: "Email alice@realcompany.com about the meeting",
          },
        ],
      }),
    });

    // The assistant message in the second request should have anonymized
    // tool_use input — no raw PII
    const secondBody = receivedBodies[1]! as Record<string, unknown>;
    const msgs = secondBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const assistantMsg = msgs[1]; // assistant with tool_use content
    expect(assistantMsg.role).toBe("assistant");
    const toolUseBlock = (
      assistantMsg.content as Array<{
        type: string;
        input?: Record<string, unknown>;
      }>
    ).find((b) => b.type === "tool_use")!;
    const inputStr = JSON.stringify(toolUseBlock.input);
    expect(inputStr).not.toContain("alice@realcompany.com");
    expect(inputStr).toContain("PII");
  });
});
