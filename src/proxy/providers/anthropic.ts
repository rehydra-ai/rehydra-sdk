/**
 * Anthropic Content Provider
 * Handles Anthropic Messages API format.
 */

import type { LLMContentProvider } from "./types.js";

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: unknown;
}

interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  stream?: boolean;
  [key: string]: unknown;
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
  [key: string]: unknown;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    [key: string]: unknown;
  };
  content_block?: AnthropicContentBlock;
  [key: string]: unknown;
}

export class AnthropicProvider implements LLMContentProvider {
  readonly name = "anthropic";

  matchesRequest(url: string, headers: Headers): boolean {
    if (url.includes("api.anthropic.com")) return true;
    if (headers.has("x-api-key")) return true;
    if (headers.has("anthropic-version")) return true;
    return false;
  }

  extractRequestText(body: unknown): string[] {
    if (body === null || body === undefined || typeof body !== "object") return [];
    const req = body as AnthropicMessagesRequest;
    const texts: string[] = [];

    // Skip system prompt — it's the LLM provider's built-in prompt,
    // never contains user secrets, and anonymizing it breaks the LLM.

    // Extract messages
    if (req.messages === undefined || !Array.isArray(req.messages)) return texts;

    for (const message of req.messages) {
      if (typeof message.content === "string") {
        texts.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            texts.push(block.text);
          }
        }
      }
    }
    return texts;
  }

  rebuildRequestBody(body: unknown, anonymizedTexts: string[]): unknown {
    if (body === null || body === undefined || typeof body !== "object") return body;
    const req = structuredClone(body) as AnthropicMessagesRequest;
    let idx = 0;

    // system prompt skipped — matches extractRequestText

    // Rebuild messages
    for (const message of req.messages) {
      if (typeof message.content === "string") {
        message.content = anonymizedTexts[idx++]!;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            block.text = anonymizedTexts[idx++]!;
          }
        }
      }
    }
    return req;
  }

  extractResponseText(body: unknown): string[] {
    if (body === null || body === undefined || typeof body !== "object") return [];
    const res = body as AnthropicMessagesResponse;
    if (res.content === undefined || !Array.isArray(res.content)) return [];

    const texts: string[] = [];
    for (const block of res.content) {
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
    return texts;
  }

  rebuildResponseBody(body: unknown, rehydratedTexts: string[]): unknown {
    if (body === null || body === undefined || typeof body !== "object") return body;
    const res = structuredClone(body) as AnthropicMessagesResponse;
    if (!Array.isArray(res.content)) return res;
    let idx = 0;

    for (const block of res.content) {
      if (block.type === "text" && typeof block.text === "string") {
        block.text = rehydratedTexts[idx++]!;
      }
    }
    return res;
  }

  extractSSEDelta(data: unknown): string | null {
    const event = data as AnthropicStreamEvent;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      return typeof event.delta.text === "string" ? event.delta.text : null;
    }
    return null;
  }

  rebuildSSEDelta(data: unknown, rehydratedText: string): unknown {
    const event = structuredClone(data) as AnthropicStreamEvent;
    if (event.delta !== undefined) {
      event.delta.text = rehydratedText;
    }
    return event;
  }

  extractSSEToolCallDelta(data: unknown): string | null {
    // Anthropic tool use: content_block_delta with input_json_delta
    const event = data as AnthropicStreamEvent;
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const partial = (event.delta as Record<string, unknown>).partial_json;
      return typeof partial === "string" ? partial : null;
    }
    return null;
  }

  rebuildSSEToolCallDelta(data: unknown, rehydratedText: string): unknown {
    const event = structuredClone(data) as AnthropicStreamEvent;
    if (event.delta !== undefined) {
      (event.delta as Record<string, unknown>).partial_json = rehydratedText;
    }
    return event;
  }

  isSSEToolCallDone(data: unknown): boolean {
    // content_block_stop signals end of a content block (including tool use)
    const event = data as AnthropicStreamEvent;
    return event.type === "content_block_stop";
  }

  isStreamingRequest(body: unknown): boolean {
    const req = body as AnthropicMessagesRequest;
    return req.stream === true;
  }
}
