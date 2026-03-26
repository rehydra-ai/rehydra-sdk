/**
 * LLM Content Provider Interface
 * Abstracts LLM-specific request/response formats for the proxy middleware.
 */

/**
 * Structured tool call information extracted from a non-streaming response.
 * Used by the tool execution loop to invoke user callbacks.
 */
export interface ToolCallInfo {
  /** Tool call ID (e.g., "call_abc123" for OpenAI, "toolu_01A..." for Anthropic) */
  id: string;
  /** Function/tool name */
  name: string;
  /** Raw arguments as JSON string (in anonymized form from LLM) */
  arguments: string;
}

/**
 * A tool result to be sent back to the LLM in the next round.
 */
export interface ToolResultMessage {
  /** The tool call ID this result corresponds to */
  toolCallId: string;
  /** The tool result content (JSON-stringified, anonymized) */
  content: string;
}

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

  // ── Tool execution loop methods ──────────────────────────────────

  /**
   * Check if a non-streaming response body contains tool calls that need execution.
   * Returns true if the response has tool_calls (OpenAI) or tool_use blocks (Anthropic).
   */
  hasResponseToolCalls?(body: unknown): boolean;

  /**
   * Extract structured tool call information from a non-streaming response.
   * Arguments are returned as raw JSON strings (in anonymized form from the LLM).
   */
  extractResponseToolCallInfo?(body: unknown): ToolCallInfo[];

  /**
   * Extract the messages array from a request body.
   */
  extractMessages?(body: unknown): unknown[];

  /**
   * Build the next-round request body for a tool execution loop.
   * Appends the assistant's tool-call response and tool result messages
   * to the current message array without re-anonymizing existing messages.
   *
   * @param originalBody - The original request body (used as template for non-message fields)
   * @param currentMessages - The current (anonymized) messages array
   * @param assistantResponse - The raw LLM response body containing tool calls
   * @param toolResults - Tool results to append (already anonymized)
   * @returns A new request body with updated messages and stream: false
   */
  buildToolLoopBody?(
    originalBody: unknown,
    currentMessages: unknown[],
    assistantResponse: unknown,
    toolResults: ToolResultMessage[],
  ): unknown;

  /**
   * Inject a system-level instruction into the request body.
   * Used to tell the model how to handle PII placeholders in tool calls.
   * Returns a new body with the instruction prepended to the system prompt.
   */
  injectSystemInstruction?(body: unknown, instruction: string): unknown;
}
