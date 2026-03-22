/**
 * OpenAI Content Provider
 * Handles OpenAI Chat Completions API format.
 */

import type { LLMContentProvider, ToolCallDelta } from "./types.js";

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

interface OpenAIToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface OpenAIStreamToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIStreamChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      tool_calls?: OpenAIStreamToolCallDelta[];
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

  extractResponseToolCalls(body: unknown): string[] {
    const res = body as OpenAIChatResponse;
    if (res.choices === undefined || !Array.isArray(res.choices)) return [];

    const args: string[] = [];
    for (const choice of res.choices) {
      const toolCalls = choice.message?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          if (typeof tc.function?.arguments === "string") {
            args.push(tc.function.arguments);
          }
        }
      }
    }
    return args;
  }

  rebuildResponseToolCalls(body: unknown, rehydratedArgs: string[]): unknown {
    const res = structuredClone(body) as OpenAIChatResponse;
    let idx = 0;

    for (const choice of res.choices) {
      const toolCalls = choice.message?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          if (typeof tc.function?.arguments === "string") {
            tc.function.arguments = rehydratedArgs[idx++]!;
          }
        }
      }
    }
    return res;
  }

  extractSSEToolCallDeltas(data: unknown): ToolCallDelta[] | null {
    const chunk = data as OpenAIStreamChunk;
    const toolCalls = chunk.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(toolCalls)) return null;

    const deltas: ToolCallDelta[] = [];
    for (const tc of toolCalls) {
      const args = tc.function?.arguments;
      if (typeof args === "string" && args.length > 0) {
        deltas.push({ index: tc.index, arguments: args });
      }
    }
    return deltas.length > 0 ? deltas : null;
  }

  rebuildSSEToolCallDeltas(
    data: unknown,
    rehydratedArgs: Map<number, string>,
  ): unknown {
    const chunk = structuredClone(data) as OpenAIStreamChunk;
    const toolCalls = chunk.choices?.[0]?.delta?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const rehydrated = rehydratedArgs.get(tc.index);
        if (rehydrated !== undefined && tc.function !== undefined) {
          tc.function.arguments = rehydrated;
        }
      }
    }
    return chunk;
  }
}
