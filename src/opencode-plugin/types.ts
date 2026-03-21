/**
 * Rehydra OpenCode Plugin Types
 */

/**
 * Configuration options for the Rehydra OpenCode plugin.
 */
export interface RehydraPluginOptions {
  /** LLM provider to intercept (e.g., "anthropic", "openai") */
  provider: string;
  /** .env file paths to scan for secret values (relative to project root) */
  envFiles?: string[];
  /** Explicit string values to always redact */
  redactValues?: string[];
  /** Minimum value length to consider as a secret (default: 8) */
  minValueLength?: number;
  /** Log anonymization stats per request to stderr (default: false) */
  logStats?: boolean;
}
