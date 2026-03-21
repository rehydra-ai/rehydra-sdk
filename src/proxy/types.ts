/**
 * Proxy Middleware Types
 */

import type { AnonymizerConfig } from "../core/anonymizer.js";
import type { AnonymizationPolicy } from "../types/index.js";
import type { KeyProvider } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";

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
