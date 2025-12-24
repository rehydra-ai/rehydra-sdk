import { describe, it, expect } from "vitest";
import { resolveEntities } from "../../src/pipeline/resolver.js";
import {
  PIIType,
  SpanMatch,
  DetectionSource,
  createDefaultPolicy,
} from "../../src/types/index.js";

describe("Entity Resolver", () => {
  const defaultPolicy = createDefaultPolicy();

  describe("resolveEntities", () => {
    it("should return all entities when no overlaps", () => {
      const regexMatches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 0,
          end: 15,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "test@test.com",
        },
      ];
      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 20,
          end: 30,
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "John Smith",
        },
      ];

      const result = resolveEntities(
        regexMatches,
        nerMatches,
        defaultPolicy,
        ""
      );

      expect(result).toHaveLength(2);
    });

    it("should prefer regex over NER when overlapping", () => {
      const text = "Contact john@company.org";
      const regexMatches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 8,
          end: 24,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "john@company.org",
        },
      ];
      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 8,
          end: 12,
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "john",
        },
      ];

      const result = resolveEntities(
        regexMatches,
        nerMatches,
        defaultPolicy,
        text
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe(PIIType.EMAIL);
      expect(result[0]?.source).toBe(DetectionSource.REGEX);
    });

    it("should prefer longer span when both are NER", () => {
      const text = "The New York Times";
      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.LOCATION,
          start: 4,
          end: 12,
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "New York",
        },
        {
          type: PIIType.ORG,
          start: 4,
          end: 18,
          confidence: 0.75,
          source: DetectionSource.NER,
          text: "New York Times",
        },
      ];

      const result = resolveEntities([], nerMatches, defaultPolicy, text);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe("New York Times");
    });

    it("should prefer higher confidence when same length", () => {
      const text = "John Smith";
      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 10,
          confidence: 0.95,
          source: DetectionSource.NER,
          text: "John Smith",
        },
        {
          type: PIIType.ORG,
          start: 0,
          end: 10,
          confidence: 0.7,
          source: DetectionSource.NER,
          text: "John Smith",
        },
      ];

      const result = resolveEntities([], nerMatches, defaultPolicy, text);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe(PIIType.PERSON);
    });

    it("should filter by confidence threshold", () => {
      const policyWithHighThreshold = {
        ...defaultPolicy,
        confidenceThresholds: new Map([[PIIType.PERSON, 0.9]]),
      };

      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 10,
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "John Smith",
        },
      ];

      const result = resolveEntities(
        [],
        nerMatches,
        policyWithHighThreshold,
        ""
      );

      expect(result).toHaveLength(0);
    });

    it("should filter by allowlist", () => {
      const policyWithAllowlist = {
        ...defaultPolicy,
        allowlistTerms: new Set(["customer service"]),
      };

      const nerMatches: SpanMatch[] = [
        {
          type: PIIType.ORG,
          start: 0,
          end: 16,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Customer Service",
        },
      ];

      const result = resolveEntities([], nerMatches, policyWithAllowlist, "");

      expect(result).toHaveLength(0);
    });

    it("should sort results by position", () => {
      const regexMatches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 50,
          end: 65,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "test@test.com",
        },
        {
          type: PIIType.PHONE,
          start: 10,
          end: 25,
          confidence: 0.9,
          source: DetectionSource.REGEX,
          text: "+49123456789",
        },
      ];

      const result = resolveEntities(regexMatches, [], defaultPolicy, "");

      expect(result[0]?.start).toBe(10);
      expect(result[1]?.start).toBe(50);
    });

    it("should handle empty inputs", () => {
      const result = resolveEntities([], [], defaultPolicy, "");
      expect(result).toHaveLength(0);
    });

    it("should filter by enabled types", () => {
      const policyWithLimitedTypes = {
        ...defaultPolicy,
        enabledTypes: new Set([PIIType.EMAIL]),
      };

      const regexMatches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 0,
          end: 15,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "test@test.com",
        },
        {
          type: PIIType.PHONE,
          start: 20,
          end: 35,
          confidence: 0.9,
          source: DetectionSource.REGEX,
          text: "+49123456789",
        },
      ];

      const result = resolveEntities(
        regexMatches,
        [],
        policyWithLimitedTypes,
        ""
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe(PIIType.EMAIL);
    });
  });
});
