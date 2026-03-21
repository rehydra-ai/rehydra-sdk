/**
 * OpenAI Content Provider
 * Handles OpenAI Chat Completions API format.
 */

import type { LLMContentProvider } from "./types.js";

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
  choices: Array<{
    delta: {
      content?: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
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
    const req = structuredClone(body) as OpenAIChatRequest;
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
    const res = structuredClone(body) as OpenAIChatResponse;
    let idx = 0;

    for (const choice of res.choices) {
      if (typeof choice.message?.content === "string") {
        choice.message.content = rehydratedTexts[idx++]!;
      }
    }
    return res;
  }

  extractSSEDelta(data: unknown): string | null {
    const chunk = data as OpenAIStreamChunk;
    const content = chunk.choices?.[0]?.delta?.content;
    if (content === undefined || content === null) return null;
    return typeof content === "string" ? content : null;
  }

  rebuildSSEDelta(data: unknown, rehydratedText: string): unknown {
    const chunk = structuredClone(data) as OpenAIStreamChunk;
    if (chunk.choices?.[0]?.delta !== undefined) {
      chunk.choices[0].delta.content = rehydratedText;
    }
    return chunk;
  }

  isStreamingRequest(body: unknown): boolean {
    const req = body as OpenAIChatRequest;
    return req.stream === true;
  }
}
