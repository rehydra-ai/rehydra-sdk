/**
 * Anthropic Content Provider
 * Handles Anthropic Messages API format.
 */

import type { LLMContentProvider, ToolCallDelta } from "./types.js";

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: unknown;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
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
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
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
    const req = body as AnthropicMessagesRequest;
    const texts: string[] = [];

    // Extract system prompt
    if (typeof req.system === "string") {
      texts.push(req.system);
    } else if (Array.isArray(req.system)) {
      for (const block of req.system) {
        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        }
      }
    }

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
    const req = structuredClone(body) as AnthropicMessagesRequest;
    let idx = 0;

    // Rebuild system prompt
    if (typeof req.system === "string") {
      req.system = anonymizedTexts[idx++]!;
    } else if (Array.isArray(req.system)) {
      for (const block of req.system) {
        if (block.type === "text" && typeof block.text === "string") {
          block.text = anonymizedTexts[idx++]!;
        }
      }
    }

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
    const res = structuredClone(body) as AnthropicMessagesResponse;
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

  isStreamingRequest(body: unknown): boolean {
    const req = body as AnthropicMessagesRequest;
    return req.stream === true;
  }

  extractResponseToolCalls(body: unknown): string[] {
    const res = body as AnthropicMessagesResponse;
    if (res.content === undefined || !Array.isArray(res.content)) return [];

    const args: string[] = [];
    for (const block of res.content) {
      if (block.type === "tool_use" && block.input !== undefined) {
        args.push(JSON.stringify(block.input));
      }
    }
    return args;
  }

  rebuildResponseToolCalls(body: unknown, rehydratedArgs: string[]): unknown {
    const res = structuredClone(body) as AnthropicMessagesResponse;
    let idx = 0;

    for (const block of res.content) {
      if (block.type === "tool_use" && block.input !== undefined) {
        try {
          block.input = JSON.parse(rehydratedArgs[idx++]!) as Record<
            string,
            unknown
          >;
        } catch (err) {
          // Leave input unchanged if rehydrated JSON is invalid
          console.warn(
            `[rehydra] Failed to parse rehydrated tool_use input at index ${idx}:`,
            err instanceof Error ? err.message : err,
          );
          idx++;
        }
      }
    }
    return res;
  }

  extractSSEToolCallDeltas(data: unknown): ToolCallDelta[] | null {
    const event = data as AnthropicStreamEvent;
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "input_json_delta" &&
      typeof event.delta.partial_json === "string" &&
      event.delta.partial_json.length > 0 &&
      typeof event.index === "number"
    ) {
      return [{ index: event.index, arguments: event.delta.partial_json }];
    }
    return null;
  }

  rebuildSSEToolCallDeltas(
    data: unknown,
    rehydratedArgs: Map<number, string>,
  ): unknown {
    const event = structuredClone(data) as AnthropicStreamEvent;
    if (
      event.delta?.type === "input_json_delta" &&
      typeof event.index === "number"
    ) {
      const rehydrated = rehydratedArgs.get(event.index);
      if (rehydrated !== undefined) {
        event.delta.partial_json = rehydrated;
      }
    }
    return event;
  }

  extractSSEToolCallStop(data: unknown): number | null {
    const event = data as AnthropicStreamEvent;
    if (
      event.type === "content_block_stop" &&
      typeof event.index === "number"
    ) {
      return event.index;
    }
    return null;
  }
}
