/**
 * LLM Content Provider Registry
 * Auto-detects the appropriate provider based on request URL/headers.
 */

import type { LLMContentProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export type { LLMContentProvider } from "./types.js";
export { OpenAIProvider } from "./openai.js";
export { AnthropicProvider } from "./anthropic.js";

/** Built-in providers — Anthropic first because its detection signals
 *  (x-api-key, anthropic-version, api.anthropic.com) are strictly more
 *  specific than OpenAI's (Bearer sk-...) */
const PROVIDERS: LLMContentProvider[] = [
  new AnthropicProvider(),
  new OpenAIProvider(),
];

/**
 * Detect the appropriate LLM content provider for a request.
 *
 * @param url - The request URL
 * @param headers - The request headers
 * @param hint - Optional provider name hint (skips auto-detection)
 * @returns The matching provider
 * @throws Error if no provider matches and no hint given
 */
export function detectProvider(
  url: string,
  headers: Headers,
  hint?: "openai" | "anthropic" | "auto",
  body?: unknown,
): LLMContentProvider {
  // Auto-detect from URL and headers first (takes priority over hint
  // so that a plugin configured for one provider can correctly handle
  // requests to a different provider's API)
  for (const provider of PROVIDERS) {
    if (provider.matchesRequest(url, headers)) {
      return provider;
    }
  }

  // Detect from request body structure as a fallback — handles cases
  // where URL is a proxy and headers are stripped/modified
  if (body !== null && body !== undefined && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    // Anthropic: top-level "system" + "messages" (no "input")
    if ("system" in obj && "messages" in obj && !("input" in obj)) {
      return PROVIDERS.find((p) => p.name === "anthropic") ?? PROVIDERS[0]!;
    }
    // OpenAI Responses API: "input" (no "messages")
    if ("input" in obj && !("messages" in obj)) {
      return PROVIDERS.find((p) => p.name === "openai") ?? PROVIDERS[0]!;
    }
  }

  // Fall back to hint
  if (hint && hint !== "auto") {
    const provider = PROVIDERS.find((p) => p.name === hint);
    if (provider) return provider;
    throw new Error(`Unknown LLM provider: ${hint}`);
  }

  // Default to OpenAI format (most common / compatible)
  return PROVIDERS.find((p) => p.name === "openai") ?? PROVIDERS[0]!;
}
