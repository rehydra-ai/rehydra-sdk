/**
 * Proxy Middleware Types
 */

import type { AnonymizerConfig } from "../core/anonymizer.js";
import type { AnonymizationPolicy } from "../types/index.js";
import type { KeyProvider } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";

/**
 * Callback invoked when the LLM requests a tool call during an agentic loop.
 * Receives rehydrated (real PII) arguments. The return value will be
 * automatically anonymized before being sent back to the LLM.
 *
 * @param name - The function/tool name
 * @param args - Parsed tool arguments with real PII values restored
 * @param toolCallId - The unique tool call ID from the LLM
 * @returns The tool execution result (will be JSON-stringified and anonymized)
 */
export type OnToolCallFn = (
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
) => unknown;

/**
 * Configuration for the Rehydra fetch wrapper
 */
export interface RehydraFetchConfig {
  /** Anonymizer configuration */
  anonymizer?: AnonymizerConfig;

  /** Policy override */
  policy?: Partial<AnonymizationPolicy>;

  /** Key provider for encryption (required) */
  keyProvider: KeyProvider;

  /** Storage provider for PII map persistence (required) */
  piiStorageProvider: PIIStorageProvider;

  /** LLM provider name or 'auto' for auto-detection */
  provider?: "openai" | "anthropic" | "auto";

  /**
   * Function to derive session ID from a request.
   * Defaults to a UUID per request.
   */
  getSessionId?: (request: Request) => string | Promise<string>;

  /**
   * Whether to handle streaming SSE responses.
   * @default true
   */
  handleStreaming?: boolean;

  /** Locale hint for anonymization */
  locale?: string;

  /**
   * System instruction injected when PII is detected, telling the model
   * to treat PII placeholders as opaque pass-through values.
   *
   * - `undefined` (default): uses the built-in instruction
   * - `string`: uses your custom instruction text
   * - `false`: disables injection entirely
   */
  systemInstruction?: string | false;

  /**
   * Callback for executing tool calls in an agentic loop.
   * When provided and the LLM returns tool calls (non-streaming), the proxy will:
   * 1. Rehydrate tool call arguments (restore real PII)
   * 2. Call this callback for each tool call
   * 3. Anonymize the return value
   * 4. Send the result back to the LLM in the next round
   * 5. Repeat until the LLM returns a final response (no tool calls)
   *
   * The callback receives real PII values — it runs on your server, not the LLM.
   * Non-streaming only (streaming tool loops are not yet supported).
   */
  onToolCall?: OnToolCallFn;

  /**
   * Maximum number of tool execution rounds before returning.
   * Prevents infinite loops. Only used when onToolCall is set.
   * @default 10
   */
  maxToolRounds?: number;
}

/**
 * Configuration for the Rehydra proxy middleware
 */
export interface RehydraProxyConfig extends RehydraFetchConfig {
  /** Upstream LLM API base URL */
  upstream: string;

  /**
   * Headers to forward to upstream.
   * @default ["authorization", "content-type", "x-api-key", "anthropic-version"]
   */
  forwardHeaders?: string[];

  /** Path prefix to strip before forwarding to upstream */
  stripPrefix?: string;
}
