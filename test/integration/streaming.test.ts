import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import {
  createAnonymizer,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  decryptPIIMap,
  rehydrate,
} from "../../src/index.js";
import { createAnonymizerStream } from "../../src/streaming/index.js";

async function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString());
  }
  return chunks.join("");
}

const TEST_TEXT =
  "Dear Support, my name is John and my email is john@example.com. " +
  "Please call me at +41 79 123 45 67 regarding case #12345. " +
  "The payment was sent to IBAN CH93 0076 2011 6238 5295 7. " +
  "You can also reach me at john.backup@company.org. " +
  "Thank you for your help. ";

describe("Streaming Integration", () => {
  it("should detect same entity types as batch anonymization", async () => {
    // Batch anonymize
    const batchAnonymizer = createAnonymizer();
    await batchAnonymizer.initialize();
    const batchResult = await batchAnonymizer.anonymize(TEST_TEXT);
    await batchAnonymizer.dispose();

    // Stream anonymize
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
    });

    const readable = Readable.from([TEST_TEXT]);
    readable.pipe(stream);
    await collectStream(stream);

    const streamEntities = stream.stats.totalEntities;
    const batchEntities = batchResult.stats.totalEntities;

    // Stream should detect at least as many entities as batch
    // (may differ slightly due to chunking, but should be close)
    expect(streamEntities).toBeGreaterThanOrEqual(batchEntities - 1);
    expect(streamEntities).toBeLessThanOrEqual(batchEntities + 1);
  });

  it("should produce rehydratable output with session", async () => {
    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    // Stream anonymize with session
    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
      sessionId: "rehydrate-test",
      piiStorageProvider: storage,
      keyProvider,
    });

    const readable = Readable.from([TEST_TEXT]);
    readable.pipe(stream);
    const anonymizedText = await collectStream(stream);

    // Verify PII was anonymized
    expect(anonymizedText).not.toContain("john@example.com");
    expect(anonymizedText).toContain('<PII type="EMAIL"');

    // Load and decrypt PII map
    const stored = await storage.load("rehydrate-test");
    expect(stored).not.toBeNull();

    const key = await keyProvider.getKey();
    const piiMap = await decryptPIIMap(stored!.piiMap, key);

    // Rehydrate
    const rehydratedText = rehydrate(anonymizedText, piiMap);

    // Verify PII was restored
    expect(rehydratedText).toContain("john@example.com");
    expect(rehydratedText).toContain("+41 79 123 45 67");
  });

  it("should handle multi-chunk input with session continuity", async () => {
    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();

    const stream = await createAnonymizerStream({
      buffer: { minBufferSize: 10, overlapChars: 0 },
      sessionId: "multi-chunk",
      piiStorageProvider: storage,
      keyProvider,
    });

    // Split input into many small chunks
    const words = TEST_TEXT.split(" ");
    const chunks = words.map((w) => w + " ");

    const readable = Readable.from(chunks);
    readable.pipe(stream);
    const output = await collectStream(stream);

    // Should have anonymized PII across chunks
    expect(output).not.toContain("john@example.com");

    // Session should be persisted
    const exists = await storage.exists("multi-chunk");
    expect(exists).toBe(true);
  });
});
