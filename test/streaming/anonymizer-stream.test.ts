import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { createAnonymizerStream } from "../../src/streaming/stream-factory.js";
import { AnonymizerStream } from "../../src/streaming/anonymizer-stream.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";

/**
 * Helper: collect all output from a stream into a string
 */
async function collectStream(stream: Readable): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
  }
  return chunks.join("");
}

/**
 * Helper: pipe a string through a transform stream
 */
async function pipeString(
  input: string,
  stream: AnonymizerStream,
): Promise<string> {
  const readable = Readable.from([input]);
  readable.pipe(stream);
  return collectStream(stream);
}

describe("AnonymizerStream", () => {
  it("should anonymize email addresses in streamed text", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const input = "Contact john@example.com for more info. ";
    const output = await pipeString(input, stream);

    // Email should be replaced with a PII tag
    expect(output).toContain('<PII type="EMAIL"');
    expect(output).not.toContain("john@example.com");
  });

  it("should anonymize multiple PII types", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const input =
      "Email john@example.com or call +41 79 123 45 67 for details. ";
    const output = await pipeString(input, stream);

    expect(output).toContain('<PII type="EMAIL"');
    expect(output).toContain('<PII type="PHONE"');
    expect(output).not.toContain("john@example.com");
  });

  it("should handle chunked input", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const chunks = [
      "Hello there. ",
      "Contact john@example.com please. ",
      "That is all. ",
    ];

    const readable = Readable.from(chunks);
    readable.pipe(stream);
    const output = await collectStream(stream);

    expect(output).toContain('<PII type="EMAIL"');
    expect(output).not.toContain("john@example.com");
  });

  it("should provide stats after processing", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    await pipeString("Contact john@example.com for details. ", stream);

    const stats = stream.stats;
    expect(stats.totalEntities).toBeGreaterThan(0);
    expect(stats.chunksProcessed).toBeGreaterThan(0);
    expect(stats.totalProcessingTimeMs).toBeGreaterThan(0);
  });

  it("should fire onChunk callback", async () => {
    const chunks: unknown[] = [];

    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
      onChunk: (event) => chunks.push(event),
    });

    await pipeString("Contact john@example.com for details. ", stream);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should fire onFinish callback", async () => {
    let finishEvent: unknown = null;

    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
      onFinish: (event) => {
        finishEvent = event;
      },
    });

    await pipeString("Contact john@example.com for details. ", stream);

    expect(finishEvent).not.toBeNull();
    expect((finishEvent as any).totalEntities).toBeGreaterThan(0);
  });

  it("should save PII map to storage when session is configured", async () => {
    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
      sessionId: "test-session",
      piiStorageProvider: storage,
      keyProvider,
    });

    await pipeString("Contact john@example.com for details. ", stream);

    // Storage should have the session's PII map
    const exists = await storage.exists("test-session");
    expect(exists).toBe(true);
  });

  it("should work in low-latency mode", async () => {
    const stream = await createAnonymizerStream({
      buffer: { lowLatency: true },
    });

    const input = "Contact john@example.com for details. ";
    const output = await pipeString(input, stream);

    // Should still detect regex patterns in low-latency mode
    expect(output).toContain('<PII type="EMAIL"');
  });

  it("should handle empty input", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const output = await pipeString("", stream);
    expect(output).toBe("");
  });

  it("should handle text without PII", async () => {
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const input = "This text has no PII in it. ";
    const output = await pipeString(input, stream);

    expect(output).toBe(input);
  });
});
