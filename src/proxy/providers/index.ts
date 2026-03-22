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

/** Built-in providers */
const PROVIDERS: LLMContentProvider[] = [
  new OpenAIProvider(),
  new AnthropicProvider(),
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
): LLMContentProvider {
  // Auto-detect from URL and headers first (takes priority over hint
  // so that a plugin configured for one provider can correctly handle
  // requests to a different provider's API)
  for (const provider of PROVIDERS) {
    if (provider.matchesRequest(url, headers)) {
      return provider;
    }
  }

  // Fall back to hint
  if (hint && hint !== "auto") {
    const provider = PROVIDERS.find((p) => p.name === hint);
    if (provider) return provider;
    throw new Error(`Unknown LLM provider: ${hint}`);
  }

  // Default to OpenAI format (most common / compatible)
  return PROVIDERS[0]!;
}
