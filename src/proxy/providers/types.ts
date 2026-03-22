/**
 * LLM Content Provider Interface
 * Abstracts LLM-specific request/response formats for the proxy middleware.
 */

/**
 * A tool call argument fragment from an SSE chunk.
 * Keyed by index to support interleaved multi-tool streaming.
 */
export interface ToolCallDelta {
  /** Numeric index identifying which tool call this fragment belongs to */
  index: number;
  /** The partial argument string fragment */
  arguments: string;
}

/**
 * Interface for extracting and rebuilding text content from LLM API requests/responses.
 * Each provider handles a specific LLM API format (OpenAI, Anthropic, etc.).
 */
export interface LLMContentProvider {
  /** Provider name (e.g., "openai", "anthropic") */
  readonly name: string;

  /** Detect if a request matches this provider based on URL/headers */
  matchesRequest(url: string, headers: Headers): boolean;

  /** Extract text strings from a request body for anonymization */
  extractRequestText(body: unknown): string[];

  /** Rebuild the request body with anonymized text (same order as extractRequestText) */
  rebuildRequestBody(body: unknown, anonymizedTexts: string[]): unknown;

  /** Extract text strings from a non-streaming response body for rehydration */
  extractResponseText(body: unknown): string[];

  /** Rebuild the response body with rehydrated text (same order as extractResponseText) */
  rebuildResponseBody(body: unknown, rehydratedTexts: string[]): unknown;

  /** Extract text delta from a parsed SSE data payload (returns null if no text content) */
  extractSSEDelta(data: unknown): string | null;

  /** Rebuild an SSE data payload with rehydrated text */
  rebuildSSEDelta(data: unknown, rehydratedText: string): unknown;

  /** Check if the request body indicates a streaming response is expected */
  isStreamingRequest(body: unknown): boolean;

  /** Extract tool call argument strings from a non-streaming response body for rehydration */
  extractResponseToolCalls?(body: unknown): string[];

  /** Rebuild the response body with rehydrated tool call arguments (same order as extractResponseToolCalls) */
  rebuildResponseToolCalls?(body: unknown, rehydratedArgs: string[]): unknown;

  /** Extract tool call argument deltas from a parsed SSE data payload */
  extractSSEToolCallDeltas?(data: unknown): ToolCallDelta[] | null;

  /** Rebuild an SSE data payload with rehydrated tool call arguments */
  rebuildSSEToolCallDeltas?(
    data: unknown,
    rehydratedArgs: Map<number, string>,
  ): unknown;

  /**
   * Detect a "tool call block finished" SSE event and return its block index.
   * Used to flush per-index tag buffers before the stop event is forwarded.
   * Returns null if this event is not a tool call stop signal.
   */
  extractSSEToolCallStop?(data: unknown): number | null;
}
