import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../../../src/proxy/providers/anthropic.js";

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider();

  describe("matchesRequest", () => {
    it("should match Anthropic API URLs", () => {
      expect(
        provider.matchesRequest(
          "https://api.anthropic.com/v1/messages",
          new Headers(),
        ),
      ).toBe(true);
    });

    it("should match requests with x-api-key header", () => {
      const headers = new Headers({ "x-api-key": "sk-ant-abc123" });
      expect(
        provider.matchesRequest("https://custom-api.example.com", headers),
      ).toBe(true);
    });

    it("should match requests with anthropic-version header", () => {
      const headers = new Headers({ "anthropic-version": "2023-06-01" });
      expect(
        provider.matchesRequest("https://custom-api.example.com", headers),
      ).toBe(true);
    });

    it("should not match unrelated URLs without Anthropic headers", () => {
      expect(
        provider.matchesRequest("https://example.com/api", new Headers()),
      ).toBe(false);
    });
  });

  describe("extractRequestText", () => {
    it("should extract string content from messages", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "user", content: "Hello world" },
          { role: "assistant", content: "Hi there" },
        ],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Hello world", "Hi there"]);
    });

    it("should extract text from content blocks", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this?" },
              { type: "image", source: { data: "..." } },
            ],
          },
        ],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["What is this?"]);
    });

    it("should skip system prompt (string)", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hi" }],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Hi"]);
    });

    it("should skip system prompt (content blocks)", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: [{ type: "text", text: "You are helpful." }],
        messages: [{ role: "user", content: "Hi" }],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["Hi"]);
    });
  });

  describe("rebuildRequestBody", () => {
    it("should replace text in messages but skip system", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: "System prompt",
        messages: [{ role: "user", content: "User message" }],
      };

      const result = provider.rebuildRequestBody(body, [
        "Anonymized user",
      ]) as any;

      expect(result.system).toBe("System prompt");
      expect(result.messages[0].content).toBe("Anonymized user");
    });

    it("should not mutate original body", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "original" }],
      };

      provider.rebuildRequestBody(body, ["modified"]);
      expect(body.messages[0].content).toBe("original");
    });
  });

  describe("extractResponseText", () => {
    it("should extract text from content blocks", () => {
      const body = {
        content: [
          { type: "text", text: "Hello!" },
          { type: "text", text: "How can I help?" },
        ],
      };

      const texts = provider.extractResponseText(body);
      expect(texts).toEqual(["Hello!", "How can I help?"]);
    });

    it("should handle missing content", () => {
      const texts = provider.extractResponseText({});
      expect(texts).toEqual([]);
    });
  });

  describe("extractSSEDelta", () => {
    it("should extract text from content_block_delta events", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      };

      expect(provider.extractSSEDelta(data)).toBe("Hello");
    });

    it("should return null for non-delta events", () => {
      expect(
        provider.extractSSEDelta({ type: "message_start" }),
      ).toBeNull();

      expect(
        provider.extractSSEDelta({ type: "content_block_start" }),
      ).toBeNull();
    });

    it("should return null for non-text deltas", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{}" },
      };

      expect(provider.extractSSEDelta(data)).toBeNull();
    });
  });

  describe("rebuildSSEDelta", () => {
    it("should replace delta text", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "anonymized" },
      };

      const result = provider.rebuildSSEDelta(data, "rehydrated") as any;
      expect(result.delta.text).toBe("rehydrated");
    });
  });

  describe("null/non-object guards", () => {
    it("extractRequestText returns [] for null", () => {
      expect(provider.extractRequestText(null)).toEqual([]);
    });

    it("extractRequestText returns [] for undefined", () => {
      expect(provider.extractRequestText(undefined)).toEqual([]);
    });

    it("extractRequestText returns [] for a non-object", () => {
      expect(provider.extractRequestText("string")).toEqual([]);
      expect(provider.extractRequestText(42)).toEqual([]);
    });

    it("rebuildRequestBody returns null for null", () => {
      expect(provider.rebuildRequestBody(null, [])).toBeNull();
    });

    it("rebuildRequestBody returns undefined for undefined", () => {
      expect(provider.rebuildRequestBody(undefined, [])).toBeUndefined();
    });

    it("rebuildRequestBody returns the value for a non-object", () => {
      expect(provider.rebuildRequestBody("string", [])).toBe("string");
    });

    it("extractResponseText returns [] for null", () => {
      expect(provider.extractResponseText(null)).toEqual([]);
    });

    it("extractResponseText returns [] for undefined", () => {
      expect(provider.extractResponseText(undefined)).toEqual([]);
    });

    it("extractResponseText returns [] for a non-object", () => {
      expect(provider.extractResponseText(123)).toEqual([]);
    });

    it("rebuildResponseBody returns null for null", () => {
      expect(provider.rebuildResponseBody(null, [])).toBeNull();
    });

    it("rebuildResponseBody returns undefined for undefined", () => {
      expect(provider.rebuildResponseBody(undefined, [])).toBeUndefined();
    });

    it("rebuildResponseBody returns the value for a non-object", () => {
      expect(provider.rebuildResponseBody("x", [])).toBe("x");
    });

    it("rebuildResponseBody returns body when content is not an array", () => {
      const body = { content: "not-an-array" };
      const result = provider.rebuildResponseBody(body, ["ignored"]) as any;
      expect(result.content).toBe("not-an-array");
    });

    it("rebuildResponseBody returns body when content is missing", () => {
      const body = { id: "msg_1" };
      const result = provider.rebuildResponseBody(body, ["ignored"]) as any;
      expect(result.id).toBe("msg_1");
      expect(result.content).toBeUndefined();
    });
  });

  describe("extractSSEToolCallDelta", () => {
    it("should return partial_json for input_json_delta", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"key":' },
      };

      expect(provider.extractSSEToolCallDelta(data)).toBe('{"key":');
    });

    it("should return null for text_delta events", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      };

      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });

    it("should return null for non-delta events", () => {
      expect(
        provider.extractSSEToolCallDelta({ type: "message_start" }),
      ).toBeNull();

      expect(
        provider.extractSSEToolCallDelta({ type: "content_block_start" }),
      ).toBeNull();
    });

    it("should return null when partial_json is not a string", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: 42 },
      };

      expect(provider.extractSSEToolCallDelta(data)).toBeNull();
    });
  });

  describe("rebuildSSEToolCallDelta", () => {
    it("should set partial_json on the delta", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"key":' },
      };

      const result = provider.rebuildSSEToolCallDelta(
        data,
        '{"anonymized_key":',
      ) as any;

      expect(result.delta.partial_json).toBe('{"anonymized_key":');
      expect(result.delta.type).toBe("input_json_delta");
    });

    it("should not mutate the original event", () => {
      const data = {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "original" },
      };

      provider.rebuildSSEToolCallDelta(data, "replaced");
      expect((data.delta as any).partial_json).toBe("original");
    });
  });

  describe("isSSEToolCallDone", () => {
    it("should return true for content_block_stop events", () => {
      expect(
        provider.isSSEToolCallDone({ type: "content_block_stop" }),
      ).toBe(true);
    });

    it("should return false for content_block_delta events", () => {
      expect(
        provider.isSSEToolCallDone({ type: "content_block_delta" }),
      ).toBe(false);
    });

    it("should return false for message_stop events", () => {
      expect(
        provider.isSSEToolCallDone({ type: "message_stop" }),
      ).toBe(false);
    });

    it("should return false for message_start events", () => {
      expect(
        provider.isSSEToolCallDone({ type: "message_start" }),
      ).toBe(false);
    });
  });

  describe("isStreamingRequest", () => {
    it("should detect streaming requests", () => {
      expect(provider.isStreamingRequest({ stream: true })).toBe(true);
      expect(provider.isStreamingRequest({ stream: false })).toBe(false);
      expect(provider.isStreamingRequest({})).toBe(false);
    });
  });
});
