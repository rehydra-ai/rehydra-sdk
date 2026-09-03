/**
 * Tests for types module
 */

import { describe, it, expect } from "vitest";
import {
  PIIType,
  ALL_PII_TYPES,
  REGEX_PII_TYPES,
  NER_PII_TYPES,
  DEFAULT_TYPE_PRIORITY,
  NER_LABEL_TO_PII_TYPE,
  getPIITypeFromNERLabel,
  createDefaultPolicy,
  mergePolicy,
  DetectionSource,
} from "../../src/types/index.js";

describe("PII Types", () => {
  describe("ALL_PII_TYPES", () => {
    it("should contain all PIIType enum values", () => {
      const enumValues = Object.values(PIIType);
      expect(ALL_PII_TYPES).toHaveLength(enumValues.length);
      for (const type of enumValues) {
        expect(ALL_PII_TYPES).toContain(type);
      }
    });
  });

  describe("REGEX_PII_TYPES", () => {
    it("should contain structured PII types", () => {
      expect(REGEX_PII_TYPES).toContain(PIIType.EMAIL);
      expect(REGEX_PII_TYPES).toContain(PIIType.PHONE);
      expect(REGEX_PII_TYPES).toContain(PIIType.IBAN);
      expect(REGEX_PII_TYPES).toContain(PIIType.CREDIT_CARD);
    });

    it("should not contain NER-only types", () => {
      expect(REGEX_PII_TYPES).not.toContain(PIIType.PERSON);
      expect(REGEX_PII_TYPES).not.toContain(PIIType.ORG);
      expect(REGEX_PII_TYPES).not.toContain(PIIType.LOCATION);
    });
  });

  describe("NER_PII_TYPES", () => {
    it("should contain soft PII types", () => {
      expect(NER_PII_TYPES).toContain(PIIType.PERSON);
      expect(NER_PII_TYPES).toContain(PIIType.ORG);
      expect(NER_PII_TYPES).toContain(PIIType.LOCATION);
      expect(NER_PII_TYPES).toContain(PIIType.ADDRESS);
      expect(NER_PII_TYPES).toContain(PIIType.DATE_OF_BIRTH);
    });

    it("should not contain regex-only types", () => {
      expect(NER_PII_TYPES).not.toContain(PIIType.EMAIL);
      expect(NER_PII_TYPES).not.toContain(PIIType.IBAN);
    });
  });

  describe("DEFAULT_TYPE_PRIORITY", () => {
    it("should contain all PII types", () => {
      const enumValues = Object.values(PIIType);
      expect(DEFAULT_TYPE_PRIORITY).toHaveLength(enumValues.length);
      for (const type of enumValues) {
        expect(DEFAULT_TYPE_PRIORITY).toContain(type);
      }
    });

    it("should have specific identifiers higher priority than generic", () => {
      const ibanIndex = DEFAULT_TYPE_PRIORITY.indexOf(PIIType.IBAN);
      const emailIndex = DEFAULT_TYPE_PRIORITY.indexOf(PIIType.EMAIL);
      const personIndex = DEFAULT_TYPE_PRIORITY.indexOf(PIIType.PERSON);

      // Higher index = higher priority
      expect(ibanIndex).toBeGreaterThan(emailIndex);
      expect(emailIndex).toBeGreaterThan(personIndex);
    });
  });

  describe("NER_LABEL_TO_PII_TYPE", () => {
    it("should map common NER labels to PII types", () => {
      expect(NER_LABEL_TO_PII_TYPE["PER"]).toBe(PIIType.PERSON);
      expect(NER_LABEL_TO_PII_TYPE["PERSON"]).toBe(PIIType.PERSON);
      expect(NER_LABEL_TO_PII_TYPE["ORG"]).toBe(PIIType.ORG);
      expect(NER_LABEL_TO_PII_TYPE["ORGANIZATION"]).toBe(PIIType.ORG);
      expect(NER_LABEL_TO_PII_TYPE["LOC"]).toBe(PIIType.LOCATION);
      expect(NER_LABEL_TO_PII_TYPE["LOCATION"]).toBe(PIIType.LOCATION);
      expect(NER_LABEL_TO_PII_TYPE["GPE"]).toBe(PIIType.LOCATION);
      expect(NER_LABEL_TO_PII_TYPE["DATE"]).toBe(PIIType.DATE);
      expect(NER_LABEL_TO_PII_TYPE["MISC"]).toBe(PIIType.ADDRESS);
    });
  });
});

describe("getPIITypeFromNERLabel", () => {
  it("should handle labels without prefix", () => {
    expect(getPIITypeFromNERLabel("PER")).toBe(PIIType.PERSON);
    expect(getPIITypeFromNERLabel("ORG")).toBe(PIIType.ORG);
    expect(getPIITypeFromNERLabel("LOC")).toBe(PIIType.LOCATION);
    expect(getPIITypeFromNERLabel("GPE")).toBe(PIIType.LOCATION);
  });

  it("should handle B- prefix (beginning of entity)", () => {
    expect(getPIITypeFromNERLabel("B-PER")).toBe(PIIType.PERSON);
    expect(getPIITypeFromNERLabel("B-ORG")).toBe(PIIType.ORG);
    expect(getPIITypeFromNERLabel("B-LOC")).toBe(PIIType.LOCATION);
  });

  it("should handle I- prefix (inside entity)", () => {
    expect(getPIITypeFromNERLabel("I-PER")).toBe(PIIType.PERSON);
    expect(getPIITypeFromNERLabel("I-ORG")).toBe(PIIType.ORG);
    expect(getPIITypeFromNERLabel("I-LOC")).toBe(PIIType.LOCATION);
  });

  it("should handle lowercase labels (without B-/I- prefix)", () => {
    // Labels without prefix are uppercased before lookup
    expect(getPIITypeFromNERLabel("per")).toBe(PIIType.PERSON);
    expect(getPIITypeFromNERLabel("org")).toBe(PIIType.ORG);
    expect(getPIITypeFromNERLabel("loc")).toBe(PIIType.LOCATION);
  });

  it("should only handle uppercase B-/I- prefixes", () => {
    // The regex only matches uppercase B-/I- prefixes
    // Lowercase prefixes are not stripped, so lookup fails
    expect(getPIITypeFromNERLabel("b-per")).toBeNull();
    expect(getPIITypeFromNERLabel("i-org")).toBeNull();
  });

  it("should return null for O (outside) label", () => {
    expect(getPIITypeFromNERLabel("O")).toBeNull();
    expect(getPIITypeFromNERLabel("o")).toBeNull();
  });

  it("should return null for unknown labels", () => {
    expect(getPIITypeFromNERLabel("UNKNOWN")).toBeNull();
    expect(getPIITypeFromNERLabel("B-UNKNOWN")).toBeNull();
    expect(getPIITypeFromNERLabel("XYZ")).toBeNull();
  });
});

describe("DetectionSource", () => {
  it("should have expected values", () => {
    expect(DetectionSource.REGEX).toBe("REGEX");
    expect(DetectionSource.NER).toBe("NER");
    expect(DetectionSource.HYBRID).toBe("HYBRID");
  });
});

describe("createDefaultPolicy", () => {
  it("should create a policy with all non-secret types enabled", () => {
    const policy = createDefaultPolicy();

    // Secret types should NOT be enabled by default (opt-in only)
    expect(policy.enabledTypes.has(PIIType.API_KEY)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.PRIVATE_KEY)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.JWT)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.CONNECTION_STRING)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.AWS_CREDENTIALS)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.ENV_VAR_SECRET)).toBe(false);
    expect(policy.enabledTypes.has(PIIType.CONFIG_SECRET)).toBe(false);

    // All non-secret types should be enabled
    expect(policy.enabledTypes.has(PIIType.EMAIL)).toBe(true);
    expect(policy.enabledTypes.has(PIIType.PERSON)).toBe(true);
    expect(policy.enabledTypes.has(PIIType.PHONE)).toBe(true);
    expect(policy.enabledTypes.has(PIIType.IBAN)).toBe(true);
    expect(policy.enabledTypes.size).toBe(19);
  });

  it("should have correct regex-enabled types", () => {
    const policy = createDefaultPolicy();

    expect(policy.regexEnabledTypes.has(PIIType.EMAIL)).toBe(true);
    expect(policy.regexEnabledTypes.has(PIIType.PHONE)).toBe(true);
    expect(policy.regexEnabledTypes.has(PIIType.IBAN)).toBe(true);
    expect(policy.regexEnabledTypes.has(PIIType.PERSON)).toBe(false);
  });

  it("should have correct NER-enabled types", () => {
    const policy = createDefaultPolicy();

    expect(policy.nerEnabledTypes.has(PIIType.PERSON)).toBe(true);
    expect(policy.nerEnabledTypes.has(PIIType.ORG)).toBe(true);
    expect(policy.nerEnabledTypes.has(PIIType.LOCATION)).toBe(true);
    expect(policy.nerEnabledTypes.has(PIIType.EMAIL)).toBe(false);
  });

  it("should have higher thresholds for NER types", () => {
    const policy = createDefaultPolicy();

    expect(policy.confidenceThresholds.get(PIIType.PERSON)).toBe(0.7);
    expect(policy.confidenceThresholds.get(PIIType.ORG)).toBe(0.7);
    expect(policy.confidenceThresholds.get(PIIType.EMAIL)).toBe(0.5);
    expect(policy.confidenceThresholds.get(PIIType.IBAN)).toBe(0.5);
  });

  it("should have correct default settings", () => {
    const policy = createDefaultPolicy();

    expect(policy.customIdPatterns).toEqual([]);
    expect(policy.allowlistTerms.size).toBe(0);
    expect(policy.denylistPatterns).toEqual([]);
    expect(policy.reuseIdsForRepeatedPII).toBe(false);
    expect(policy.enableLeakScan).toBe(true);
    expect(policy.enableSemanticMasking).toBe(false);
  });

  it("should use DEFAULT_TYPE_PRIORITY", () => {
    const policy = createDefaultPolicy();

    expect(policy.typePriority).toEqual([...DEFAULT_TYPE_PRIORITY]);
  });
});

describe("mergePolicy", () => {
  it("should return default policy when given empty partial", () => {
    const merged = mergePolicy({});
    const defaultPolicy = createDefaultPolicy();

    expect(merged.enabledTypes).toEqual(defaultPolicy.enabledTypes);
    expect(merged.enableLeakScan).toBe(defaultPolicy.enableLeakScan);
    expect(merged.enableSemanticMasking).toBe(
      defaultPolicy.enableSemanticMasking
    );
  });

  it("should override enabledTypes", () => {
    const customTypes = new Set([PIIType.EMAIL, PIIType.PHONE]);
    const merged = mergePolicy({ enabledTypes: customTypes });

    expect(merged.enabledTypes).toBe(customTypes);
    expect(merged.enabledTypes.size).toBe(2);
  });

  it("should override enableLeakScan", () => {
    const merged = mergePolicy({ enableLeakScan: false });
    expect(merged.enableLeakScan).toBe(false);
  });

  it("should override enableSemanticMasking", () => {
    const merged = mergePolicy({ enableSemanticMasking: true });
    expect(merged.enableSemanticMasking).toBe(true);
  });

  it("should override reuseIdsForRepeatedPII", () => {
    const merged = mergePolicy({ reuseIdsForRepeatedPII: true });
    expect(merged.reuseIdsForRepeatedPII).toBe(true);
  });

  it("should override allowlistTerms", () => {
    const allowlist = new Set(["Test Company", "Support Team"]);
    const merged = mergePolicy({ allowlistTerms: allowlist });

    expect(merged.allowlistTerms).toBe(allowlist);
    expect(merged.allowlistTerms.has("Test Company")).toBe(true);
  });

  it("should override denylistPatterns", () => {
    const denylist = [/secret/i, /password/i];
    const merged = mergePolicy({ denylistPatterns: denylist });

    expect(merged.denylistPatterns).toBe(denylist);
    expect(merged.denylistPatterns).toHaveLength(2);
  });

  it("should override customIdPatterns", () => {
    const patterns = [
      {
        name: "Order ID",
        pattern: /ORD-\d+/g,
        type: PIIType.CASE_ID,
      },
    ];
    const merged = mergePolicy({ customIdPatterns: patterns });

    expect(merged.customIdPatterns).toBe(patterns);
    expect(merged.customIdPatterns).toHaveLength(1);
  });

  it("should override typePriority", () => {
    const customPriority = [PIIType.EMAIL, PIIType.PERSON];
    const merged = mergePolicy({ typePriority: customPriority });

    expect(merged.typePriority).toBe(customPriority);
  });

  it("should merge confidenceThresholds with defaults", () => {
    const customThresholds = new Map<PIIType, number>([
      [PIIType.EMAIL, 0.9],
      [PIIType.PERSON, 0.95],
    ]);
    const merged = mergePolicy({ confidenceThresholds: customThresholds });

    // Custom values should override
    expect(merged.confidenceThresholds.get(PIIType.EMAIL)).toBe(0.9);
    expect(merged.confidenceThresholds.get(PIIType.PERSON)).toBe(0.95);

    // Other values should use defaults
    expect(merged.confidenceThresholds.get(PIIType.IBAN)).toBe(0.5);
    expect(merged.confidenceThresholds.get(PIIType.ORG)).toBe(0.7);
  });

  it("should override regexEnabledTypes", () => {
    const customTypes = new Set([PIIType.EMAIL]);
    const merged = mergePolicy({ regexEnabledTypes: customTypes });

    expect(merged.regexEnabledTypes).toBe(customTypes);
    expect(merged.regexEnabledTypes.size).toBe(1);
  });

  it("should override nerEnabledTypes", () => {
    const customTypes = new Set([PIIType.PERSON]);
    const merged = mergePolicy({ nerEnabledTypes: customTypes });

    expect(merged.nerEnabledTypes).toBe(customTypes);
    expect(merged.nerEnabledTypes.size).toBe(1);
  });

  it("should handle multiple overrides at once", () => {
    const merged = mergePolicy({
      enableLeakScan: false,
      enableSemanticMasking: true,
      reuseIdsForRepeatedPII: true,
      allowlistTerms: new Set(["Test"]),
      confidenceThresholds: new Map([[PIIType.EMAIL, 0.99]]),
    });

    expect(merged.enableLeakScan).toBe(false);
    expect(merged.enableSemanticMasking).toBe(true);
    expect(merged.reuseIdsForRepeatedPII).toBe(true);
    expect(merged.allowlistTerms.has("Test")).toBe(true);
    expect(merged.confidenceThresholds.get(PIIType.EMAIL)).toBe(0.99);
    // Defaults preserved
    expect(merged.confidenceThresholds.get(PIIType.PERSON)).toBe(0.7);
  });
});
