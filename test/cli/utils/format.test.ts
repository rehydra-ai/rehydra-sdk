import { describe, it, expect } from "vitest";
import { formatText, formatJson, formatNdjson, formatInspect, formatStats } from "../../../src/cli/utils/format.js";
import { PIIType, DetectionSource } from "../../../src/types/index.js";
import type { AnonymizationResult, AnonymizationStats } from "../../../src/types/index.js";

function makeResult(overrides?: Partial<AnonymizationResult>): AnonymizationResult {
  return {
    anonymizedText: 'Contact <PII type="EMAIL" id="1"/> for help.',
    entities: [
      {
        type: PIIType.EMAIL,
        id: 1,
        start: 8,
        end: 28,
        confidence: 1.0,
        source: DetectionSource.REGEX,
      },
    ],
    stats: {
      totalEntities: 1,
      countsByType: { [PIIType.EMAIL]: 1 } as Record<PIIType, number>,
      modelVersion: "test",
      policyVersion: "test",
      processingTimeMs: 5,
    },
    ...overrides,
  };
}

describe("formatText", () => {
  it("should return the anonymized text as-is", () => {
    const result = makeResult();
    expect(formatText(result)).toBe(result.anonymizedText);
  });
});

describe("formatJson", () => {
  it("should produce valid JSON with expected fields", () => {
    const result = makeResult();
    const json = formatJson(result);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).toHaveProperty("anonymizedText");
    expect(parsed).toHaveProperty("entities");
    expect(parsed).toHaveProperty("stats");
    expect((parsed["entities"] as unknown[]).length).toBe(1);
  });

  it("should include entity type, id, confidence, and source", () => {
    const result = makeResult();
    const parsed = JSON.parse(formatJson(result)) as { entities: Array<Record<string, unknown>> };
    const entity = parsed.entities[0]!;

    expect(entity["type"]).toBe("EMAIL");
    expect(entity["id"]).toBe(1);
    expect(entity["confidence"]).toBe(1.0);
    expect(entity["source"]).toBe("REGEX");
  });
});

describe("formatNdjson", () => {
  it("should produce one line per entity plus a summary line", () => {
    const result = makeResult();
    const lines = formatNdjson(result).split("\n").filter(Boolean);
    expect(lines.length).toBe(2); // 1 entity + 1 summary

    const entity = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entity["type"]).toBe("EMAIL");

    const summary = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(summary["_type"]).toBe("summary");
    expect(summary["totalEntities"]).toBe(1);
  });
});

describe("formatInspect", () => {
  it("should wrap PII in type labels", () => {
    const text = "Contact support@example.com for help.";
    const entities = [
      { type: PIIType.EMAIL, original: "support@example.com", start: 8, end: 27 },
    ];

    // With NO_COLOR-like behavior, we just check that the type label appears
    const output = formatInspect(text, entities);
    expect(output).toContain("EMAIL");
    expect(output).toContain("support@example.com");
  });
});

describe("formatStats", () => {
  it("should include entity count and types", () => {
    const stats: AnonymizationStats = {
      totalEntities: 3,
      countsByType: {
        [PIIType.EMAIL]: 1,
        [PIIType.PHONE]: 2,
      } as Record<PIIType, number>,
      modelVersion: "test",
      policyVersion: "test",
      processingTimeMs: 10,
    };

    const output = formatStats(stats);
    expect(output).toContain("3");
    expect(output).toContain("EMAIL");
    expect(output).toContain("PHONE");
    expect(output).toContain("10ms");
  });
});
