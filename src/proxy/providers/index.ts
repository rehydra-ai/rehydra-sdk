/**
 * LLM Content Provider Registry
 * Auto-detects the appropriate provider from request body structure,
 * URL, headers, or a caller-provided hint (in that priority order).
 */

import type { LLMContentProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export type { LLMContentProvider } from "./types.js";
export { OpenAIProvider } from "./openai.js";
export { AnthropicProvider } from "./anthropic.js";

const ANTHROPIC = new AnthropicProvider();
const OPENAI = new OpenAIProvider();

/**
 * Detect the appropriate LLM content provider for a request.
 *
 * Detection priority:
 * 1. Body structure (most reliable — survives proxies/gateways)
 * 2. URL and headers
 * 3. Caller-provided hint
 * 4. Default: OpenAI (most common format)
 */
export function detectProvider(
  url: string,
  headers: Headers,
  hint?: "openai" | "anthropic" | "auto",
  body?: unknown,
): LLMContentProvider {
  // 1. Body structure — unambiguous, proxy-safe
  if (body !== null && body !== undefined && typeof body === "object") {
    const obj = body as Record<string, unknown>;

    // Anthropic: top-level "system" field (OpenAI uses role:"system" inside messages)
    if ("system" in obj && "messages" in obj) {
      return ANTHROPIC;
    }

    // OpenAI Responses API: "input" without "messages"
    if ("input" in obj && !("messages" in obj)) {
      return OPENAI;
    }
  }

  // 2. URL and headers
  if (ANTHROPIC.matchesRequest(url, headers)) return ANTHROPIC;
  if (OPENAI.matchesRequest(url, headers)) return OPENAI;

  // 3. Caller hint
  if (hint === "anthropic") return ANTHROPIC;
  if (hint === "openai") return OPENAI;

  // 4. Default
  return OPENAI;
}
