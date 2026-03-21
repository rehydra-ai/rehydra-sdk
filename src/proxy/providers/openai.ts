/**
 * OpenAI Content Provider
 * Handles both Chat Completions API and Responses API formats.
 */

import type { LLMContentProvider } from "./types.js";

// --- Chat Completions API types ---

interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[] | null;
  name?: string;
}

interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: unknown;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta: {
      content?: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

// --- Responses API types ---

interface OpenAIResponsesInputItem {
  type?: string;
  role?: string;
  content?: string | OpenAIResponsesContentPart[];
  text?: string;
  [key: string]: unknown;
}

interface OpenAIResponsesContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface OpenAIResponsesRequest {
  model: string;
  input: string | OpenAIResponsesInputItem[];
  instructions?: string;
  text?: unknown;
  stream?: boolean;
  [key: string]: unknown;
}

interface OpenAIResponsesStreamEvent {
  type?: string;
  delta?: string;
  item?: { type?: string; text?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface OpenAIResponsesResponse {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

function isResponsesAPI(body: Record<string, unknown>): boolean {
  return "input" in body && !("messages" in body);
}

function extractInputTexts(input: string | OpenAIResponsesInputItem[]): string[] {
  const texts: string[] = [];
  if (typeof input === "string") {
    texts.push(input);
  } else if (Array.isArray(input)) {
    for (const item of input) {
      // role-based items (user, developer): content field
      if (typeof item.content === "string") {
        texts.push(item.content);
      } else if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "input_text" && typeof part.text === "string") {
            texts.push(part.text);
          } else if (part.type === "text" && typeof part.text === "string") {
            texts.push(part.text);
          }
        }
      }
      if (typeof item.text === "string") {
        texts.push(item.text);
      }
      // function_call_output: tool results (file contents, command output)
      const output = (item as Record<string, unknown>).output;
      if (typeof output === "string") {
        texts.push(output);
      }
      // function_call: tool call arguments (may contain secrets)
      const args = (item as Record<string, unknown>).arguments;
      if (typeof args === "string") {
        texts.push(args);
      }
      // summary field on reasoning items
      const summary = (item as Record<string, unknown>).summary;
      if (typeof summary === "string") {
        texts.push(summary);
      }
    }
  }
  return texts;
}

function rebuildInputTexts(
  input: string | OpenAIResponsesInputItem[],
  texts: string[],
  startIdx: number,
): { rebuilt: string | OpenAIResponsesInputItem[]; nextIdx: number } {
  let idx = startIdx;
  if (typeof input === "string") {
    return { rebuilt: texts[idx++]!, nextIdx: idx };
  }

  const rebuilt = structuredClone(input);
  for (const item of rebuilt) {
    if (typeof item.content === "string") {
      item.content = texts[idx++]!;
    } else if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part.type === "input_text" || part.type === "text") && typeof part.text === "string") {
          part.text = texts[idx++]!;
        }
      }
    }
    if (typeof item.text === "string") {
      item.text = texts[idx++]!;
    }
    // function_call_output
    const rec = item as Record<string, unknown>;
    if (typeof rec.output === "string") {
      rec.output = texts[idx++]!;
    }
    // function_call arguments
    if (typeof rec.arguments === "string") {
      rec.arguments = texts[idx++]!;
    }
    // reasoning summary
    if (typeof rec.summary === "string") {
      rec.summary = texts[idx++]!;
    }
  }
  return { rebuilt, nextIdx: idx };
}

export class OpenAIProvider implements LLMContentProvider {
  readonly name = "openai";

  matchesRequest(url: string, headers: Headers): boolean {
    if (url.includes("api.openai.com")) return true;
    const auth = headers.get("authorization");
    if (auth !== null && auth.startsWith("Bearer sk-")) return true;
    return false;
  }

  extractRequestText(body: unknown): string[] {
    if (body === null || body === undefined || typeof body !== "object") return [];
    const obj = body as Record<string, unknown>;

    // Responses API: { input, instructions, ... }
    if (isResponsesAPI(obj)) {
      const req = body as OpenAIResponsesRequest;
      const texts: string[] = [];

      // Skip instructions (system prompt) — it's the LLM provider's built-in prompt,
      // never contains user secrets, and anonymizing it breaks the LLM.

      texts.push(...extractInputTexts(req.input));
      return texts;
    }

    // Chat Completions API: { messages, ... }
    const req = body as OpenAIChatRequest;
    if (req.messages === undefined || !Array.isArray(req.messages)) return [];

    const texts: string[] = [];
    for (const message of req.messages) {
      if (typeof message.content === "string") {
        texts.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text" && typeof part.text === "string") {
            texts.push(part.text);
          }
        }
      }
    }
    return texts;
  }

  rebuildRequestBody(body: unknown, anonymizedTexts: string[]): unknown {
    if (body === null || body === undefined || typeof body !== "object") return body;
    const obj = body as Record<string, unknown>;

    // Responses API
    if (isResponsesAPI(obj)) {
      const req = structuredClone(body) as OpenAIResponsesRequest;
      const idx = 0;

      // instructions skipped — matches extractRequestText
      const { rebuilt, nextIdx } = rebuildInputTexts(req.input, anonymizedTexts, idx);
      req.input = rebuilt;
      void nextIdx;
      return req;
    }

    // Chat Completions API
    const req = structuredClone(body) as OpenAIChatRequest;
    if (!Array.isArray(req.messages)) return req;
    let idx = 0;

    for (const message of req.messages) {
      if (typeof message.content === "string") {
        message.content = anonymizedTexts[idx++]!;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text" && typeof part.text === "string") {
            part.text = anonymizedTexts[idx++]!;
          }
        }
      }
    }
    return req;
  }

  extractResponseText(body: unknown): string[] {
    if (body === null || body === undefined || typeof body !== "object") return [];
    const obj = body as Record<string, unknown>;

    // Responses API response: { output: [{ content: [{ text }] }] }
    if (Array.isArray(obj.output)) {
      const res = body as OpenAIResponsesResponse;
      const texts: string[] = [];
      for (const item of res.output!) {
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "text" && typeof part.text === "string") {
              texts.push(part.text);
            }
          }
        }
      }
      return texts;
    }

    // Chat Completions API response
    const res = body as OpenAIChatResponse;
    if (res.choices === undefined || !Array.isArray(res.choices)) return [];

    const texts: string[] = [];
    for (const choice of res.choices) {
      if (typeof choice.message?.content === "string") {
        texts.push(choice.message.content);
      }
    }
    return texts;
  }

  rebuildResponseBody(body: unknown, rehydratedTexts: string[]): unknown {
    if (body === null || body === undefined || typeof body !== "object") return body;
    const obj = body as Record<string, unknown>;

    // Responses API response
    if (Array.isArray(obj.output)) {
      const res = structuredClone(body) as OpenAIResponsesResponse;
      let idx = 0;
      for (const item of res.output!) {
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "text" && typeof part.text === "string") {
              part.text = rehydratedTexts[idx++]!;
            }
          }
        }
      }
      return res;
    }

    // Chat Completions API response
    const res = structuredClone(body) as OpenAIChatResponse;
    if (!Array.isArray(res.choices)) return res;
    let idx = 0;

    for (const choice of res.choices) {
      if (typeof choice.message?.content === "string") {
        choice.message.content = rehydratedTexts[idx++]!;
      }
    }
    return res;
  }

  extractSSEDelta(data: unknown): string | null {
    if (data === null || data === undefined || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;

    // Responses API streaming: only return deltas for text content events.
    // Function call argument deltas (response.function_call_arguments.delta)
    // also have a "delta" field but contain JSON fragments with escaped quotes
    // that need different handling (deep rehydration, not text-level).
    if (typeof obj.type === "string") {
      if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
        return obj.delta;
      }
      // All other typed events (function_call_arguments, etc.) → return null
      // so they go through the deep rehydration path
      return null;
    }

    // No type field — could be Chat Completions API streaming
    if (typeof obj.delta === "string") {
      return obj.delta;
    }

    // Chat Completions API streaming
    const chunk = data as OpenAIStreamChunk;
    const content = chunk.choices?.[0]?.delta?.content;
    if (content === undefined || content === null) return null;
    return typeof content === "string" ? content : null;
  }

  rebuildSSEDelta(data: unknown, rehydratedText: string): unknown {
    if (data === null || data === undefined || typeof data !== "object") return data;
    const obj = data as Record<string, unknown>;

    // Responses API streaming
    if (typeof obj.delta === "string") {
      const rebuilt = structuredClone(data) as Record<string, unknown>;
      rebuilt.delta = rehydratedText;
      return rebuilt;
    }

    // Chat Completions API streaming
    const chunk = structuredClone(data) as OpenAIStreamChunk;
    if (chunk.choices?.[0]?.delta !== undefined) {
      chunk.choices[0].delta.content = rehydratedText;
    }
    return chunk;
  }

  isStreamingRequest(body: unknown): boolean {
    if (body === null || body === undefined || typeof body !== "object") return false;
    return (body as { stream?: boolean }).stream === true;
  }
}
