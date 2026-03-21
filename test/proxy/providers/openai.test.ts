import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "../../../src/proxy/providers/openai.js";

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider();

  describe("matchesRequest", () => {
    it("should match OpenAI API URLs", () => {
      expect(
        provider.matchesRequest(
          "https://api.openai.com/v1/chat/completions",
          new Headers(),
        ),
      ).toBe(true);
    });

    it("should match requests with OpenAI-style bearer token", () => {
      const headers = new Headers({ Authorization: "Bearer sk-abc123" });
      expect(
        provider.matchesRequest("https://custom-api.example.com/v1", headers),
      ).toBe(true);
    });

    it("should not match unrelated URLs without OpenAI headers", () => {
      expect(
        provider.matchesRequest(
          "https://example.com/api",
          new Headers(),
        ),
      ).toBe(false);
    });
  });

  describe("extractRequestText", () => {
    it("should extract string content from messages", () => {
      const body = {
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello world" },
        ],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["You are helpful.", "Hello world"]);
    });

    it("should extract text from array content (multimodal)", () => {
      const body = {
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image_url", image_url: { url: "data:..." } },
            ],
          },
        ],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["What is in this image?"]);
    });

    it("should handle null content", () => {
      const body = {
        model: "gpt-4",
        messages: [{ role: "assistant", content: null }],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual([]);
    });

    it("should handle missing messages", () => {
      const texts = provider.extractRequestText({ model: "gpt-4" });
      expect(texts).toEqual([]);
    });
  });

  describe("rebuildRequestBody", () => {
    it("should replace text in messages", () => {
      const body = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Email john@example.com" },
        ],
      };

      const result = provider.rebuildRequestBody(body, [
        'Email <PII type="EMAIL" id="1"/>',
      ]) as any;

      expect(result.messages[0].content).toBe(
        'Email <PII type="EMAIL" id="1"/>',
      );
      expect(result.model).toBe("gpt-4");
    });

    it("should not mutate original body", () => {
      const body = {
        model: "gpt-4",
        messages: [{ role: "user", content: "original" }],
      };

      provider.rebuildRequestBody(body, ["modified"]);
      expect(body.messages[0].content).toBe("original");
    });
  });

  describe("extractResponseText", () => {
    it("should extract content from choices", () => {
      const body = {
        choices: [
          { message: { role: "assistant", content: "Hello!" } },
        ],
      };

      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["Hello!"]);
    });

    it("should handle multiple choices", () => {
      const body = {
        choices: [
          { message: { role: "assistant", content: "Response 1" } },
          { message: { role: "assistant", content: "Response 2" } },
        ],
      };

      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["Response 1", "Response 2"]);
    });
  });

  describe("extractSSEDelta", () => {
    it("should extract delta content", () => {
      const data = {
        choices: [{ delta: { content: "Hello" } }],
      };

      expect(provider.extractSSEDelta(data)).toBe("Hello");
    });

    it("should return null for empty delta", () => {
      const data = {
        choices: [{ delta: {} }],
      };

      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for null content", () => {
      const data = {
        choices: [{ delta: { content: null } }],
      };

      expect(provider.extractSSEDelta(data)).toBeNull();
    });
  });

  describe("rebuildSSEDelta", () => {
    it("should replace delta content", () => {
      const data = {
        choices: [{ delta: { content: "anonymized" } }],
      };

      const result = provider.rebuildSSEDelta(data, "rehydrated") as any;
      expect(result.choices[0].delta.content).toBe("rehydrated");
    });
  });

  describe("isStreamingRequest", () => {
    it("should detect streaming requests", () => {
      expect(provider.isStreamingRequest({ stream: true })).toBe(true);
      expect(provider.isStreamingRequest({ stream: false })).toBe(false);
      expect(provider.isStreamingRequest({})).toBe(false);
    });

    it("should return false for null/undefined/non-object", () => {
      expect(provider.isStreamingRequest(null)).toBe(false);
      expect(provider.isStreamingRequest(undefined)).toBe(false);
      expect(provider.isStreamingRequest("string")).toBe(false);
    });
  });

  // ─── Responses API: extractRequestText ───────────────────────────

  describe("extractRequestText (Responses API)", () => {
    it("should extract from string input", () => {
      const body = {
        model: "gpt-4.1",
        input: "Tell me about John Doe at john@example.com",
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Tell me about John Doe at john@example.com"]);
    });

    it("should extract from array input with string content", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          { role: "user", content: "Hello from user" },
          { role: "developer", content: "System instructions" },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Hello from user", "System instructions"]);
    });

    it("should extract from array input with content parts (input_text)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "First part" },
              { type: "input_text", text: "Second part" },
            ],
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["First part", "Second part"]);
    });

    it("should extract from array input with content parts (text type)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "text", text: "Text type part" },
            ],
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Text type part"]);
    });

    it("should extract the text field from items", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          { type: "message", text: "Direct text field" },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Direct text field"]);
    });

    it("should extract the output field (function_call_output)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "function_call_output",
            call_id: "call_123",
            output: '{"result": "secret data from tool"}',
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(['{"result": "secret data from tool"}']);
    });

    it("should extract the arguments field (function_call)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "function_call",
            name: "get_user",
            arguments: '{"name": "John Doe"}',
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(['{"name": "John Doe"}']);
    });

    it("should extract the summary field (reasoning items)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "reasoning",
            summary: "The user mentioned their email john@example.com",
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["The user mentioned their email john@example.com"]);
    });

    it("should extract all field types from a single item", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "complex_item",
            content: "content text",
            text: "text field",
            output: "output text",
            arguments: "args text",
            summary: "summary text",
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual([
        "content text",
        "text field",
        "output text",
        "args text",
        "summary text",
      ]);
    });

    it("should skip non-text content parts (e.g., image)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: "data:..." },
              { type: "input_text", text: "Describe this" },
            ],
          },
        ],
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Describe this"]);
    });

    it("should not extract instructions (system prompt)", () => {
      const body = {
        model: "gpt-4.1",
        input: "User question",
        instructions: "You are a helpful assistant.",
      };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["User question"]);
    });

    it("should return empty array for empty input array", () => {
      const body = { model: "gpt-4.1", input: [] };
      const texts = provider.extractRequestText(body);
      expect(texts).toEqual([]);
    });
  });

  // ─── Responses API: rebuildRequestBody ────────────────────────────

  describe("rebuildRequestBody (Responses API)", () => {
    it("should rebuild string input", () => {
      const body = {
        model: "gpt-4.1",
        input: "Email john@example.com",
      };
      const result = provider.rebuildRequestBody(body, [
        'Email <PII type="EMAIL" id="1"/>',
      ]) as any;

      expect(result.input).toBe('Email <PII type="EMAIL" id="1"/>');
      expect(result.model).toBe("gpt-4.1");
    });

    it("should rebuild array input with string content", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          { role: "user", content: "Hello from user" },
          { role: "developer", content: "Dev instructions" },
        ],
      };
      const result = provider.rebuildRequestBody(body, [
        "anon-user",
        "anon-dev",
      ]) as any;

      expect(result.input[0].content).toBe("anon-user");
      expect(result.input[1].content).toBe("anon-dev");
    });

    it("should rebuild array input with content parts", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Part 1" },
              { type: "text", text: "Part 2" },
            ],
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, [
        "anon-1",
        "anon-2",
      ]) as any;

      expect(result.input[0].content[0].text).toBe("anon-1");
      expect(result.input[0].content[1].text).toBe("anon-2");
    });

    it("should rebuild text field", () => {
      const body = {
        model: "gpt-4.1",
        input: [{ type: "message", text: "Original text" }],
      };
      const result = provider.rebuildRequestBody(body, ["anon-text"]) as any;
      expect(result.input[0].text).toBe("anon-text");
    });

    it("should rebuild output field (function_call_output)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "function_call_output",
            call_id: "call_123",
            output: '{"secret": "data"}',
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, ["anon-output"]) as any;
      expect(result.input[0].output).toBe("anon-output");
    });

    it("should rebuild arguments field (function_call)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "function_call",
            name: "get_user",
            arguments: '{"name": "John"}',
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, ["anon-args"]) as any;
      expect(result.input[0].arguments).toBe("anon-args");
    });

    it("should rebuild summary field (reasoning items)", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "reasoning",
            summary: "Original summary",
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, [
        "anon-summary",
      ]) as any;
      expect(result.input[0].summary).toBe("anon-summary");
    });

    it("should rebuild all field types from a single item in correct order", () => {
      const body = {
        model: "gpt-4.1",
        input: [
          {
            type: "complex",
            content: "c",
            text: "t",
            output: "o",
            arguments: "a",
            summary: "s",
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, [
        "C",
        "T",
        "O",
        "A",
        "S",
      ]) as any;

      expect(result.input[0].content).toBe("C");
      expect(result.input[0].text).toBe("T");
      expect(result.input[0].output).toBe("O");
      expect(result.input[0].arguments).toBe("A");
      expect(result.input[0].summary).toBe("S");
    });

    it("should not mutate original body (Responses API)", () => {
      const body = {
        model: "gpt-4.1",
        input: "original text",
      };
      provider.rebuildRequestBody(body, ["modified"]);
      expect(body.input).toBe("original text");
    });

    it("should not mutate original body for array input", () => {
      const body = {
        model: "gpt-4.1",
        input: [{ role: "user", content: "original" }],
      };
      provider.rebuildRequestBody(body, ["modified"]);
      expect(body.input[0].content).toBe("original");
    });
  });

  // ─── Responses API: extractResponseText ───────────────────────────

  describe("extractResponseText (Responses API)", () => {
    it("should extract text from output content", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [
              { type: "text", text: "Hello from the model!" },
            ],
          },
        ],
      };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["Hello from the model!"]);
    });

    it("should extract text from multiple output items", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [{ type: "text", text: "First" }],
          },
          {
            type: "message",
            content: [{ type: "text", text: "Second" }],
          },
        ],
      };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["First", "Second"]);
    });

    it("should skip non-text output content parts", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [
              { type: "refusal", refusal: "I cannot do that" },
              { type: "text", text: "But I can do this" },
            ],
          },
        ],
      };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["But I can do this"]);
    });

    it("should handle output items without content array", () => {
      const body = {
        output: [
          { type: "function_call", name: "get_weather", arguments: "{}" },
        ],
      };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual([]);
    });
  });

  // ─── Responses API: rebuildResponseBody ───────────────────────────

  describe("rebuildResponseBody (Responses API)", () => {
    it("should rebuild text in output content", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [{ type: "text", text: "anonymized" }],
          },
        ],
      };
      const result = provider.rebuildResponseBody(body, ["rehydrated"]) as any;
      expect(result.output[0].content[0].text).toBe("rehydrated");
    });

    it("should not mutate original body", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [{ type: "text", text: "original" }],
          },
        ],
      };
      provider.rebuildResponseBody(body, ["modified"]);
      expect(body.output[0].content[0].text).toBe("original");
    });
  });

  // ─── Responses API: extractSSEDelta ───────────────────────────────

  describe("extractSSEDelta (Responses API)", () => {
    it("should extract text delta from response.output_text.delta", () => {
      const data = {
        type: "response.output_text.delta",
        delta: "Hello ",
      };
      expect(provider.extractSSEDelta(data)).toBe("Hello ");
    });

    it("should return null for response.function_call_arguments.delta", () => {
      const data = {
        type: "response.function_call_arguments.delta",
        delta: '{"name":',
      };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for response.created", () => {
      const data = { type: "response.created", response: {} };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for response.completed", () => {
      const data = { type: "response.completed", response: {} };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for response.output_item.added", () => {
      const data = { type: "response.output_item.added", item: {} };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for response.output_text.done", () => {
      const data = { type: "response.output_text.done", text: "full text" };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for response.function_call_arguments.done", () => {
      const data = {
        type: "response.function_call_arguments.done",
        arguments: '{"full": "args"}',
      };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });
  });

  // ─── Chat Completions: extractSSEDelta (additional) ───────────────

  describe("extractSSEDelta (Chat Completions additional)", () => {
    it("should extract delta from a direct delta field (no type field)", () => {
      const data = { delta: "raw delta text" };
      expect(provider.extractSSEDelta(data)).toBe("raw delta text");
    });

    it("should return null for non-string delta content in choices", () => {
      const data = {
        choices: [{ delta: { content: 42 } }],
      };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });

    it("should return null for missing choices", () => {
      const data = { id: "chatcmpl-123" };
      expect(provider.extractSSEDelta(data)).toBeNull();
    });
  });

  // ─── Responses API: rebuildSSEDelta ───────────────────────────────

  describe("rebuildSSEDelta (Responses API)", () => {
    it("should rebuild Responses API text delta", () => {
      const data = {
        type: "response.output_text.delta",
        delta: "anonymized chunk",
        output_index: 0,
        content_index: 0,
      };
      const result = provider.rebuildSSEDelta(data, "rehydrated chunk") as any;
      expect(result.delta).toBe("rehydrated chunk");
      expect(result.type).toBe("response.output_text.delta");
      expect(result.output_index).toBe(0);
    });

    it("should not mutate original data (Responses API delta)", () => {
      const data = {
        type: "response.output_text.delta",
        delta: "original",
      };
      provider.rebuildSSEDelta(data, "modified");
      expect(data.delta).toBe("original");
    });
  });

  // ─── extractSSEToolCallDelta ──────────────────────────────────────

  describe("extractSSEToolCallDelta", () => {
    it("should extract Responses API function_call_arguments.delta", () => {
      const data = {
        type: "response.function_call_arguments.delta",
        delta: '{"loc',
      };
      expect(provider.extractSSEToolCallDelta(data)).toBe('{"loc');
    });

    it("should extract Chat Completions tool_calls arguments", () => {
      const data = {
        choices: [
          {
            delta: {
              tool_calls: [
                { function: { arguments: '": "New' } },
              ],
            },
          },
        ],
      };
      expect(provider.extractSSEToolCallDelta(data)).toBe('": "New');
    });

    it("should return null for non-tool-call events (Responses API)", () => {
      const data = {
        type: "response.output_text.delta",
        delta: "Hello",
      };
      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });

    it("should return null for Chat Completions without tool_calls", () => {
      const data = {
        choices: [{ delta: { content: "Hello" } }],
      };
      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });

    it("should return null for empty tool_calls array", () => {
      const data = {
        choices: [{ delta: { tool_calls: [] } }],
      };
      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });

    it("should return null for tool_calls without function.arguments", () => {
      const data = {
        choices: [
          {
            delta: {
              tool_calls: [{ id: "call_123", type: "function" }],
            },
          },
        ],
      };
      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });

    it("should return null for null/undefined/non-object", () => {
      expect(provider.extractSSEToolCallDelta(null)).toBeNull();
      expect(provider.extractSSEToolCallDelta(undefined)).toBeNull();
      expect(provider.extractSSEToolCallDelta("string")).toBeNull();
      expect(provider.extractSSEToolCallDelta(42)).toBeNull();
    });
  });

  // ─── rebuildSSEToolCallDelta ──────────────────────────────────────

  describe("rebuildSSEToolCallDelta", () => {
    it("should rebuild Responses API function_call_arguments.delta", () => {
      const data = {
        type: "response.function_call_arguments.delta",
        delta: '{"name":',
        call_id: "call_abc",
        output_index: 0,
      };
      const result = provider.rebuildSSEToolCallDelta(
        data,
        '{"name_anon":',
      ) as any;
      expect(result.delta).toBe('{"name_anon":');
      expect(result.type).toBe("response.function_call_arguments.delta");
      expect(result.call_id).toBe("call_abc");
      expect(result.output_index).toBe(0);
    });

    it("should rebuild Chat Completions tool_calls arguments", () => {
      const data = {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: "call_123",
                  function: { name: "get_user", arguments: '": "John' },
                },
              ],
            },
          },
        ],
      };
      const result = provider.rebuildSSEToolCallDelta(
        data,
        '": "anon_1',
      ) as any;
      expect(result.choices[0].delta.tool_calls[0].function.arguments).toBe(
        '": "anon_1',
      );
      // Should preserve other fields
      expect(result.choices[0].delta.tool_calls[0].id).toBe("call_123");
      expect(result.choices[0].delta.tool_calls[0].function.name).toBe(
        "get_user",
      );
    });

    it("should not mutate original data (Responses API)", () => {
      const data = {
        type: "response.function_call_arguments.delta",
        delta: "original",
      };
      provider.rebuildSSEToolCallDelta(data, "modified");
      expect(data.delta).toBe("original");
    });

    it("should not mutate original data (Chat Completions)", () => {
      const data = {
        choices: [
          {
            delta: {
              tool_calls: [
                { function: { arguments: "original" } },
              ],
            },
          },
        ],
      };
      provider.rebuildSSEToolCallDelta(data, "modified");
      expect(data.choices[0].delta.tool_calls[0].function.arguments).toBe(
        "original",
      );
    });

    it("should return data as-is for null/undefined/non-object", () => {
      expect(provider.rebuildSSEToolCallDelta(null, "text")).toBeNull();
      expect(provider.rebuildSSEToolCallDelta(undefined, "text")).toBeUndefined();
      expect(provider.rebuildSSEToolCallDelta("str", "text")).toBe("str");
    });
  });

  // ─── isSSEToolCallDone ────────────────────────────────────────────

  describe("isSSEToolCallDone", () => {
    it("should return true for Responses API done event", () => {
      const data = {
        type: "response.function_call_arguments.done",
        arguments: '{"location": "NYC"}',
        call_id: "call_abc",
      };
      expect(provider.isSSEToolCallDone(data)).toBe(true);
    });

    it("should return true for Chat Completions finish_reason tool_calls", () => {
      const data = {
        choices: [
          {
            finish_reason: "tool_calls",
            delta: {},
          },
        ],
      };
      expect(provider.isSSEToolCallDone(data)).toBe(true);
    });

    it("should return false for text delta events", () => {
      const data = {
        type: "response.output_text.delta",
        delta: "Hello",
      };
      expect(provider.isSSEToolCallDone(data)).toBe(false);
    });

    it("should return false for Chat Completions finish_reason stop", () => {
      const data = {
        choices: [{ finish_reason: "stop", delta: {} }],
      };
      expect(provider.isSSEToolCallDone(data)).toBe(false);
    });

    it("should return false for Chat Completions with no finish_reason", () => {
      const data = {
        choices: [{ delta: { content: "Hello" } }],
      };
      expect(provider.isSSEToolCallDone(data)).toBe(false);
    });

    it("should return false for null/undefined/non-object", () => {
      expect(provider.isSSEToolCallDone(null)).toBe(false);
      expect(provider.isSSEToolCallDone(undefined)).toBe(false);
      expect(provider.isSSEToolCallDone("string")).toBe(false);
      expect(provider.isSSEToolCallDone(42)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(provider.isSSEToolCallDone({})).toBe(false);
    });
  });

  // ─── Null/undefined guards on all methods ─────────────────────────

  describe("null/undefined guards", () => {
    it("extractRequestText returns [] for null/undefined/non-object", () => {
      expect(provider.extractRequestText(null)).toEqual([]);
      expect(provider.extractRequestText(undefined)).toEqual([]);
      expect(provider.extractRequestText("string")).toEqual([]);
      expect(provider.extractRequestText(42)).toEqual([]);
    });

    it("rebuildRequestBody returns input as-is for null/undefined/non-object", () => {
      expect(provider.rebuildRequestBody(null, ["text"])).toBeNull();
      expect(provider.rebuildRequestBody(undefined, ["text"])).toBeUndefined();
      expect(provider.rebuildRequestBody("str", ["text"])).toBe("str");
    });

    it("extractResponseText returns [] for null/undefined/non-object", () => {
      expect(provider.extractResponseText(null)).toEqual([]);
      expect(provider.extractResponseText(undefined)).toEqual([]);
      expect(provider.extractResponseText("string")).toEqual([]);
      expect(provider.extractResponseText(42)).toEqual([]);
    });

    it("rebuildResponseBody returns input as-is for null/undefined/non-object", () => {
      expect(provider.rebuildResponseBody(null, ["text"])).toBeNull();
      expect(provider.rebuildResponseBody(undefined, ["text"])).toBeUndefined();
      expect(provider.rebuildResponseBody("str", ["text"])).toBe("str");
    });

    it("extractSSEDelta returns null for null/undefined/non-object", () => {
      expect(provider.extractSSEDelta(null)).toBeNull();
      expect(provider.extractSSEDelta(undefined)).toBeNull();
      expect(provider.extractSSEDelta("string")).toBeNull();
      expect(provider.extractSSEDelta(42)).toBeNull();
    });

    it("rebuildSSEDelta returns input as-is for null/undefined/non-object", () => {
      expect(provider.rebuildSSEDelta(null, "text")).toBeNull();
      expect(provider.rebuildSSEDelta(undefined, "text")).toBeUndefined();
      expect(provider.rebuildSSEDelta("str", "text")).toBe("str");
    });
  });

  // ─── Chat Completions: rebuildRequestBody multimodal ──────────────

  describe("rebuildRequestBody (Chat Completions multimodal)", () => {
    it("should rebuild text in array content parts", () => {
      const body = {
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image_url", image_url: { url: "data:..." } },
            ],
          },
        ],
      };
      const result = provider.rebuildRequestBody(body, [
        "Describe the image",
      ]) as any;
      expect(result.messages[0].content[0].text).toBe("Describe the image");
      // image part should be preserved
      expect(result.messages[0].content[1].type).toBe("image_url");
    });

    it("should handle messages with no extractable text", () => {
      const body = {
        model: "gpt-4",
        messages: [{ role: "assistant", content: null }],
      };
      const result = provider.rebuildRequestBody(body, []) as any;
      expect(result.messages[0].content).toBeNull();
    });
  });

  // ─── Chat Completions: rebuildResponseBody additional ─────────────

  describe("rebuildResponseBody (Chat Completions additional)", () => {
    it("should handle missing choices", () => {
      const body = { id: "chatcmpl-123" };
      const result = provider.rebuildResponseBody(body, []) as any;
      expect(result.id).toBe("chatcmpl-123");
    });

    it("should handle null message content in choices", () => {
      const body = {
        choices: [{ message: { role: "assistant", content: null } }],
      };
      const result = provider.rebuildResponseBody(body, []) as any;
      expect(result.choices[0].message.content).toBeNull();
    });

    it("should not mutate original body (Chat Completions)", () => {
      const body = {
        choices: [
          { message: { role: "assistant", content: "original" } },
        ],
      };
      provider.rebuildResponseBody(body, ["modified"]);
      expect(body.choices[0].message.content).toBe("original");
    });
  });

  // ─── Chat Completions: rebuildSSEDelta additional ─────────────────

  describe("rebuildSSEDelta (Chat Completions additional)", () => {
    it("should not mutate original data (Chat Completions)", () => {
      const data = {
        choices: [{ delta: { content: "original" } }],
      };
      provider.rebuildSSEDelta(data, "modified");
      expect(data.choices[0].delta.content).toBe("original");
    });

    it("should handle chunk without choices gracefully", () => {
      const data = { id: "chatcmpl-123" };
      const result = provider.rebuildSSEDelta(data, "text") as any;
      // Should return the cloned data without crash
      expect(result.id).toBe("chatcmpl-123");
    });
  });

  // ─── extractResponseText null guards ──────────────────────────────

  describe("extractResponseText (additional)", () => {
    it("should handle missing choices in Chat Completions", () => {
      const body = { id: "chatcmpl-123", object: "chat.completion" };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual([]);
    });

    it("should handle null content in choices", () => {
      const body = {
        choices: [{ message: { role: "assistant", content: null } }],
      };
      const texts = provider.extractResponseText(body);
      expect(texts).toEqual([]);
    });
  });
});
