/**
 * LLM Client Wrapper
 * Convenience function to wrap OpenAI/Anthropic SDK clients
 * with automatic PII anonymization and rehydration.
 */

import { createRehydraFetch } from "./rehydra-fetch.js";
import type { RehydraFetchConfig } from "./types.js";

/**
 * Wraps an LLM client (OpenAI, Anthropic, or any SDK that accepts a custom fetch)
 * to automatically anonymize outgoing PII and rehydrate responses.
 *
 * Works by replacing the client's internal fetch with a Rehydra-wrapped version.
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { wrapLLMClient, InMemoryKeyProvider, InMemoryPIIStorageProvider } from 'rehydra';
 *
 * const openai = wrapLLMClient(
 *   new OpenAI(),
 *   {
 *     keyProvider: new InMemoryKeyProvider(),
 *     piiStorageProvider: new InMemoryPIIStorageProvider(),
 *   },
 * );
 *
 * // PII is now automatically anonymized/rehydrated
 * const response = await openai.chat.completions.create({ ... });
 * ```
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { wrapLLMClient, ConfigKeyProvider, SQLitePIIStorageProvider } from 'rehydra';
 *
 * const anthropic = wrapLLMClient(
 *   new Anthropic(),
 *   {
 *     keyProvider: new ConfigKeyProvider(process.env.PII_KEY!),
 *     piiStorageProvider: new SQLitePIIStorageProvider('pii.db'),
 *   },
 * );
 *
 * const message = await anthropic.messages.create({ ... });
 * ```
 */
export function wrapLLMClient<T>(
  client: T,
  config: Omit<RehydraFetchConfig, "provider">,
): T {
  const rehydraFetch = createRehydraFetch({
    ...config,
    provider: "auto",
  });

  // Both OpenAI and Anthropic SDKs store fetch as a property.
  // OpenAI uses `_fetch`, Anthropic uses `fetch`.
  // We try both, and also support any client with a `fetch` property.
  const clientObj = client as Record<string, unknown>;

  if ("_fetch" in clientObj) {
    // OpenAI SDK pattern
    clientObj._fetch = rehydraFetch;
  } else if ("fetch" in clientObj) {
    // Anthropic SDK pattern (or generic)
    clientObj.fetch = rehydraFetch;
  } else {
    // Fallback: set both common patterns
    clientObj._fetch = rehydraFetch;
    clientObj.fetch = rehydraFetch;
  }

  return client;
}
