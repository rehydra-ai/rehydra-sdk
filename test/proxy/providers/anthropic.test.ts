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

    it("should extract system prompt (string)", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hi" }],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["You are helpful.", "Hi"]);
    });

    it("should extract system prompt (content blocks)", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: [{ type: "text", text: "You are helpful." }],
        messages: [{ role: "user", content: "Hi" }],
      };

      const texts = provider.extractRequestText(body);
      expect(texts).toEqual(["You are helpful.", "Hi"]);
    });
  });

  describe("rebuildRequestBody", () => {
    it("should replace text in messages and system", () => {
      const body = {
        model: "claude-sonnet-4-20250514",
        system: "System prompt",
        messages: [{ role: "user", content: "User message" }],
      };

      const result = provider.rebuildRequestBody(body, [
        "Anonymized system",
        "Anonymized user",
      ]) as any;

      expect(result.system).toBe("Anonymized system");
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

  describe("isStreamingRequest", () => {
    it("should detect streaming requests", () => {
      expect(provider.isStreamingRequest({ stream: true })).toBe(true);
      expect(provider.isStreamingRequest({ stream: false })).toBe(false);
      expect(provider.isStreamingRequest({})).toBe(false);
    });
  });
});
