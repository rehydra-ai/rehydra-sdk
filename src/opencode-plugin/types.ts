/**
 * Rehydra OpenCode Plugin Types
 */

/**
 * Log level for the Rehydra plugin.
 * - "normal": Logs a summary per request (PII types scrubbed, counts)
 * - "debug": Full diagnostic logging (extracted texts, diffs, raw input shapes)
 * - false: No logging
 */
export type RehydraLogLevel = "normal" | "debug" | false;

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
  /**
   * Log level and file path.
   * - { level: "normal", file: "rehydra.log" } — compact summary per request
   * - { level: "debug", file: "rehydra-debug.log" } — full diagnostic output
   * - false or omitted — no logging
   */
  log?: { level: RehydraLogLevel; file: string } | false;
  /**
   * @deprecated Use `log` instead. If set and `log` is not, treated as `{ level: "debug", file: logFile }`.
   */
  logFile?: string;
  /** @deprecated Use `log` instead. */
  logStats?: boolean;
}
