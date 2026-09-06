import { describe, it, expect } from 'vitest';
import {
  validateOutput,
  ValidationErrorCode,
  hasNoOverlaps,
} from '../../src/pipeline/validator.js';
import { PIIType, DetectedEntity, DetectionSource, createDefaultPolicy } from '../../src/types/index.js';

describe('Validator', () => {
  const defaultPolicy = createDefaultPolicy();

  describe('validateOutput', () => {
    it('should pass for valid output', () => {
      const anonymizedText = 'Hello <PII type="PERSON" id="1"/>!';
      const entities: DetectedEntity[] = [
        {
          type: PIIType.PERSON,
          id: 1,
          start: 6,
          end: 16,
          confidence: 0.9,
          source: DetectionSource.NER,
          original: 'John',
        },
      ];
      const piiMapKeys = ['PERSON_1'];

      const result = validateOutput(anonymizedText, entities, piiMapKeys, defaultPolicy);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect overlapping entities', () => {
      const entities: DetectedEntity[] = [
        { type: PIIType.PERSON, id: 1, start: 0, end: 10, confidence: 0.9, source: DetectionSource.NER, original: 'John Smith' },
        { type: PIIType.ORG, id: 2, start: 5, end: 15, confidence: 0.8, source: DetectionSource.NER, original: 'Smith Corp' },
      ];

      const result = validateOutput('', entities, ['PERSON_1', 'ORG_2'], defaultPolicy);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === ValidationErrorCode.OVERLAPPING_ENTITIES)).toBe(true);
    });

    it('should detect duplicate IDs with different text', () => {
      const entities: DetectedEntity[] = [
        { type: PIIType.PERSON, id: 1, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, original: 'John' },
        { type: PIIType.PERSON, id: 1, start: 10, end: 14, confidence: 0.9, source: DetectionSource.NER, original: 'Jane' },
      ];

      const result = validateOutput('', entities, ['PERSON_1'], defaultPolicy);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === ValidationErrorCode.DUPLICATE_IDS)).toBe(true);
    });

    it('should allow duplicate IDs with same text (reuse mode)', () => {
      const entities: DetectedEntity[] = [
        { type: PIIType.PERSON, id: 1, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, original: 'John' },
        { type: PIIType.PERSON, id: 1, start: 10, end: 14, confidence: 0.9, source: DetectionSource.NER, original: 'John' },
      ];

      const result = validateOutput('', entities, ['PERSON_1'], defaultPolicy);

      // Should not have duplicate ID error when text is the same
      expect(result.errors.filter(e => e.code === ValidationErrorCode.DUPLICATE_IDS)).toHaveLength(0);
    });

    it('should detect missing PII map entries', () => {
      const entities: DetectedEntity[] = [
        { type: PIIType.PERSON, id: 1, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, original: 'John' },
      ];

      const result = validateOutput('', entities, [], defaultPolicy); // Empty map

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === ValidationErrorCode.MISSING_IN_MAP)).toBe(true);
    });
  });

  describe('leak scan', () => {
    it('should detect potential email leaks', () => {
      // Text with an untagged email that should be detected as a leak
      const anonymizedText = 'Contact support or test@example.com for help';
      const entities: DetectedEntity[] = [];

      const result = validateOutput(anonymizedText, entities, [], defaultPolicy);

      expect(result.leakScanPassed).toBe(false);
      expect(result.potentialLeaks?.length).toBeGreaterThan(0);
      expect(result.potentialLeaks?.[0]?.type).toBe(PIIType.EMAIL);
    });

    it('should detect potential UK postcode leaks regardless of casing', () => {
      const result = validateOutput('Deliver to n16 4hy', [], [], defaultPolicy);

      expect(result.leakScanPassed).toBe(false);
      expect(result.potentialLeaks).toContainEqual(
        expect.objectContaining({
          type: PIIType.POSTAL_CODE,
          text: 'n16 4hy',
          pattern: 'UK Postal Code',
        }),
      );
    });

    it('should not flag text inside tags as leaks', () => {
      // The tag itself contains "type" and other text, should not match
      const anonymizedText = 'Hello <PII type="EMAIL" id="1"/>!';
      const entities: DetectedEntity[] = [];

      const result = validateOutput(anonymizedText, entities, [], defaultPolicy);

      expect(result.leakScanPassed).toBe(true);
    });

    it('should skip leak scan when disabled', () => {
      const policyNoScan = { ...defaultPolicy, enableLeakScan: false };
      const anonymizedText = 'Contact test@example.com'; // Has email but scan disabled

      const result = validateOutput(anonymizedText, [], [], policyNoScan);

      expect(result.leakScanPassed).toBeUndefined();
    });
  });

  describe('hasNoOverlaps', () => {
    it('should return true for non-overlapping spans', () => {
      const spans = [
        { start: 0, end: 5 },
        { start: 10, end: 15 },
        { start: 20, end: 25 },
      ];

      expect(hasNoOverlaps(spans)).toBe(true);
    });

    it('should return false for overlapping spans', () => {
      const spans = [
        { start: 0, end: 10 },
        { start: 5, end: 15 },
      ];

      expect(hasNoOverlaps(spans)).toBe(false);
    });

    it('should return true for adjacent spans', () => {
      const spans = [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
      ];

      expect(hasNoOverlaps(spans)).toBe(true);
    });

    it('should return true for empty array', () => {
      expect(hasNoOverlaps([])).toBe(true);
    });

    it('should return true for single span', () => {
      expect(hasNoOverlaps([{ start: 0, end: 10 }])).toBe(true);
    });
  });
});
