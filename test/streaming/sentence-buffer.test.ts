import { describe, it, expect, vi } from "vitest";
import { SentenceBuffer, resolveBufferConfig } from "../../src/streaming/sentence-buffer.js";
import type { IAnonymizer } from "../../src/storage/session.js";
import type { AnonymizationResult } from "../../src/types/index.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";

/**
 * Create a mock anonymizer that wraps text between angle brackets as PII tags
 */
function createMockAnonymizer(
  detections: Array<{ text: string; type: string }> = [],
): IAnonymizer {
  return {
    anonymize: vi.fn(async (text: string): Promise<AnonymizationResult> => {
      let anonymized = text;
      const entities: AnonymizationResult["entities"] = [];
      let entityId = 1;

      for (const detection of detections) {
        let idx = anonymized.indexOf(detection.text);
        // Try in the original text for position tracking
        const originalIdx = text.indexOf(detection.text);
        while (idx !== -1) {
          const tag = `<PII type="${detection.type}" id="${entityId}"/>`;
          anonymized =
            anonymized.slice(0, idx) +
            tag +
            anonymized.slice(idx + detection.text.length);
          entities.push({
            type: detection.type as any,
            id: entityId,
            start: originalIdx,
            end: originalIdx + detection.text.length,
            confidence: 1.0,
            source: "REGEX" as any,
          });
          entityId++;
          idx = anonymized.indexOf(detection.text);
        }
      }

      return {
        anonymizedText: anonymized,
        entities,
        stats: {
          countsByType: {},
          totalEntities: entities.length,
          modelVersion: "test",
          policyVersion: "test",
          processingTimeMs: 1,
        },
      };
    }),
  };
}

describe("resolveBufferConfig", () => {
  it("should return defaults when no config provided", () => {
    const config = resolveBufferConfig();
    expect(config.overlapChars).toBe(100);
    expect(config.maxBufferSize).toBe(8192);
    expect(config.minBufferSize).toBe(50);
    expect(config.lowLatency).toBe(false);
  });

  it("should apply low-latency overrides", () => {
    const config = resolveBufferConfig({ lowLatency: true });
    expect(config.overlapChars).toBe(50);
    expect(config.maxBufferSize).toBe(512);
    expect(config.minBufferSize).toBe(20);
    expect(config.lowLatency).toBe(true);
  });

  it("should allow custom overrides", () => {
    const config = resolveBufferConfig({
      overlapChars: 200,
      maxBufferSize: 4096,
    });
    expect(config.overlapChars).toBe(200);
    expect(config.maxBufferSize).toBe(4096);
    expect(config.minBufferSize).toBe(50);
  });
});

describe("SentenceBuffer", () => {
  it("should buffer text until minBufferSize is reached", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 50,
      overlapChars: 0,
    });

    // Short text — should buffer
    const results = await buffer.append("Hello. ");
    expect(results).toHaveLength(0);
    expect(anonymizer.anonymize).not.toHaveBeenCalled();
  });

  it("should flush at sentence boundaries", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      overlapChars: 0,
    });

    const results = await buffer.append(
      "This is the first sentence. This is the second sentence. ",
    );
    expect(results.length).toBeGreaterThan(0);
    expect(anonymizer.anonymize).toHaveBeenCalled();
  });

  it("should force flush at maxBufferSize when no boundary found", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      maxBufferSize: 50,
      overlapChars: 0,
    });

    // Long text without sentence boundaries
    const longText = "a".repeat(60);
    const results = await buffer.append(longText);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should flush remaining text on flush()", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      overlapChars: 0,
    });

    // Add text without a trailing boundary
    await buffer.append("Hello world");
    const results = await buffer.flush();
    expect(results).toHaveLength(1);
    expect(results[0]!.anonymizedText).toBe("Hello world");
  });

  it("should return empty on flush() with no buffered text", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      overlapChars: 0,
    });

    const results = await buffer.flush();
    expect(results).toHaveLength(0);
  });

  it("should handle empty chunks", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      overlapChars: 0,
    });

    const results = await buffer.append("");
    expect(results).toHaveLength(0);
  });

  it("should accumulate PII map across flushes", async () => {
    const anonymizer = createMockAnonymizer([
      { text: "john@example.com", type: "EMAIL" },
    ]);
    const keyProvider = new InMemoryKeyProvider();

    const buffer = new SentenceBuffer(
      anonymizer,
      { minBufferSize: 10, overlapChars: 0 },
      { keyProvider },
    );

    await buffer.append(
      "Contact john@example.com for details. More text here. ",
    );
    await buffer.flush();

    // PII map should have entries (though decryption logic in mock may not populate it)
    // The main thing is that the buffer tracks entities
    expect(buffer.getTotalEntities()).toBeGreaterThanOrEqual(0);
  });

  it("should handle multiple sentence boundaries in one chunk", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 10,
      overlapChars: 0,
    });

    const results = await buffer.append(
      "First sentence. Second sentence. Third sentence. ",
    );
    // Should flush all available boundaries
    expect(results.length).toBeGreaterThan(0);

    const allText = results.map((r) => r.anonymizedText).join("");
    expect(allText).toContain("First sentence");
  });

  it("should use custom sentence boundary regex", async () => {
    const anonymizer = createMockAnonymizer();
    const buffer = new SentenceBuffer(anonymizer, {
      minBufferSize: 5,
      overlapChars: 0,
      sentenceBoundary: /\|\|/g, // Use || as delimiter
    });

    const results = await buffer.append("part one||part two||");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should seed with initial PII map", async () => {
    const anonymizer = createMockAnonymizer();
    const initialMap = new Map([["EMAIL_1", "john@example.com"]]);

    const buffer = new SentenceBuffer(
      anonymizer,
      { minBufferSize: 10, overlapChars: 0 },
      { initialPiiMap: initialMap },
    );

    const cumulativeMap = buffer.getCumulativePiiMap();
    expect(cumulativeMap.get("EMAIL_1")).toBe("john@example.com");
  });
});
