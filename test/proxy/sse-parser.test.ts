import { describe, it, expect } from "vitest";
import { SSEParser, isSSEDone, serializeSSEEvent } from "../../src/proxy/sse-parser.js";

describe("SSEParser", () => {
  it("should parse a single complete event", () => {
    const parser = new SSEParser();
    const events = parser.parse('data: {"content": "hello"}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("message");
    expect(events[0]!.data).toBe('{"content": "hello"}');
  });

  it("should parse multiple events in one chunk", () => {
    const parser = new SSEParser();
    const events = parser.parse(
      'data: {"a": 1}\n\ndata: {"b": 2}\n\ndata: {"c": 3}\n\n',
    );

    expect(events).toHaveLength(3);
    expect(events[0]!.data).toBe('{"a": 1}');
    expect(events[1]!.data).toBe('{"b": 2}');
    expect(events[2]!.data).toBe('{"c": 3}');
  });

  it("should handle events split across chunks", () => {
    const parser = new SSEParser();

    // First chunk — incomplete event
    const events1 = parser.parse('data: {"content": ');
    expect(events1).toHaveLength(0);

    // Second chunk — completes the event
    const events2 = parser.parse('"hello"}\n\n');
    expect(events2).toHaveLength(1);
    expect(events2[0]!.data).toBe('{"content": "hello"}');
  });

  it("should parse event type field", () => {
    const parser = new SSEParser();
    const events = parser.parse(
      'event: content_block_delta\ndata: {"text": "hi"}\n\n',
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("content_block_delta");
    expect(events[0]!.data).toBe('{"text": "hi"}');
  });

  it("should handle multi-line data fields", () => {
    const parser = new SSEParser();
    const events = parser.parse("data: line1\ndata: line2\ndata: line3\n\n");

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("line1\nline2\nline3");
  });

  it("should handle empty data lines", () => {
    const parser = new SSEParser();
    const events = parser.parse("data:\n\n");

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("");
  });

  it("should ignore comment lines", () => {
    const parser = new SSEParser();
    const events = parser.parse(": this is a comment\ndata: hello\n\n");

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("hello");
  });

  it("should handle [DONE] sentinel", () => {
    const parser = new SSEParser();
    const events = parser.parse("data: [DONE]\n\n");

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("[DONE]");
  });

  it("should flush remaining buffer", () => {
    const parser = new SSEParser();

    // Incomplete — no trailing double newline
    parser.parse("data: leftover");
    const events = parser.flush();

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("leftover");
  });

  it("should return empty on flush with empty buffer", () => {
    const parser = new SSEParser();
    const events = parser.flush();
    expect(events).toHaveLength(0);
  });

  it("should handle \\r\\n line endings", () => {
    const parser = new SSEParser();
    const events = parser.parse('data: hello\r\n\r\ndata: world\r\n\r\n');

    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe("hello");
    expect(events[1]!.data).toBe("world");
  });

  it("should reset parser state", () => {
    const parser = new SSEParser();

    // Add incomplete data
    parser.parse("data: incomplete");
    parser.reset();

    // After reset, previous data is gone
    const events = parser.flush();
    expect(events).toHaveLength(0);
  });

  it("should skip events with no data", () => {
    const parser = new SSEParser();
    const events = parser.parse("event: ping\n\n");

    expect(events).toHaveLength(0);
  });
});

describe("isSSEDone", () => {
  it("should detect [DONE] sentinel", () => {
    expect(isSSEDone("[DONE]")).toBe(true);
    expect(isSSEDone(" [DONE] ")).toBe(true);
  });

  it("should not match non-DONE data", () => {
    expect(isSSEDone('{"content": "hello"}')).toBe(false);
    expect(isSSEDone("DONE")).toBe(false);
  });
});

describe("serializeSSEEvent", () => {
  it("should serialize a simple message event", () => {
    const result = serializeSSEEvent({
      event: "message",
      data: '{"content": "hello"}',
    });
    expect(result).toBe('data: {"content": "hello"}\n\n');
  });

  it("should include event type when not message", () => {
    const result = serializeSSEEvent({
      event: "content_block_delta",
      data: '{"text": "hi"}',
    });
    expect(result).toBe(
      'event: content_block_delta\ndata: {"text": "hi"}\n\n',
    );
  });

  it("should handle multi-line data", () => {
    const result = serializeSSEEvent({
      event: "message",
      data: "line1\nline2",
    });
    expect(result).toBe("data: line1\ndata: line2\n\n");
  });
});
