/**
 * Server-Sent Events (SSE) Parser
 * Parses SSE protocol streams, handling chunk boundaries correctly.
 */

/**
 * A parsed SSE event
 */
export interface SSEEvent {
  /** Event type (defaults to "message") */
  event: string;
  /** Event data (concatenated from all data: lines) */
  data: string;
}

/**
 * Parses a Server-Sent Events stream chunk by chunk.
 *
 * SSE protocol format:
 * ```
 * event: message_start
 * data: {"type": "content"}
 *
 * data: {"text": "Hello"}
 *
 * data: [DONE]
 *
 * ```
 *
 * Each event is one or more field lines terminated by a blank line.
 */
export class SSEParser {
  private buffer = "";

  /**
   * Feed a chunk of text from the SSE stream.
   * Returns zero or more fully parsed events.
   */
  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    // Split on double newline (event boundary)
    // Handle both \n\n and \r\n\r\n
    const parts = this.buffer.split(/\n\n|\r\n\r\n/);

    // Last part may be incomplete — keep it in the buffer
    this.buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (part.trim() === "") continue;
      const event = this.parseEvent(part);
      if (event) events.push(event);
    }

    return events;
  }

  /**
   * Flush remaining buffer content (call on stream end).
   * Returns any remaining events.
   */
  flush(): SSEEvent[] {
    if (this.buffer.trim() === "") {
      this.buffer = "";
      return [];
    }
    const event = this.parseEvent(this.buffer);
    this.buffer = "";
    return event ? [event] : [];
  }

  /**
   * Reset the parser state.
   */
  reset(): void {
    this.buffer = "";
  }

  /**
   * Parse a single raw SSE event block into an SSEEvent.
   */
  private parseEvent(raw: string): SSEEvent | null {
    let data = "";
    let eventType = "message";

    for (const line of raw.split(/\n|\r\n/)) {
      if (line.startsWith("data: ")) {
        // Concatenate multiple data: lines with newlines
        data += (data ? "\n" : "") + line.slice(6);
      } else if (line === "data:") {
        // Empty data line
        data += (data ? "\n" : "");
      } else if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      }
      // Ignore 'id:', 'retry:', and comments (lines starting with ':')
    }

    if (data === "" && !raw.includes("data:")) return null;

    return { event: eventType, data };
  }
}

/**
 * Check if a string is the SSE stream termination sentinel.
 */
export function isSSEDone(data: string): boolean {
  return data.trim() === "[DONE]";
}

/**
 * Serialize an SSE event back to wire format.
 */
export function serializeSSEEvent(event: SSEEvent): string {
  let result = "";
  if (event.event !== "message") {
    result += `event: ${event.event}\n`;
  }
  // Split data on newlines for multi-line data fields
  for (const line of event.data.split("\n")) {
    result += `data: ${line}\n`;
  }
  result += "\n";
  return result;
}
