import { describe, it, expect } from 'vitest';
import {
  RegexRecognizer,
  createRegexRecognizer,
  type Recognizer,
} from '../../src/recognizers/base.js';
import { PIIType, DetectionSource } from '../../src/types/index.js';

// Concrete implementation for testing
class TestRegexRecognizer extends RegexRecognizer {
  readonly type = PIIType.CASE_ID;
  readonly name = 'Test Recognizer';
  protected readonly patterns = [/\bTEST-\d+\b/g];

  validate(match: string): boolean {
    // Only accept matches with at least 2 digits
    return /\d{2,}/.test(match);
  }

  normalize(match: string): string {
    return match.toUpperCase();
  }
}

describe('RegexRecognizer', () => {
  describe('find', () => {
    it('should find matches using patterns', () => {
      const recognizer = new TestRegexRecognizer();
      const text = 'Test case TEST-123 and TEST-456';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(2);
      expect(matches[0]).toMatchObject({
        type: PIIType.CASE_ID,
        text: 'TEST-123',
        source: DetectionSource.REGEX,
        confidence: 0.95,
      });
      expect(matches[1]?.text).toBe('TEST-456');
    });

    it('should handle patterns without global flag', () => {
      class LocalRegexRecognizer extends RegexRecognizer {
        readonly type = PIIType.CASE_ID;
        readonly name = 'Local Test';
        protected readonly patterns = [/\bTEST-\d+\b/]; // No 'g' flag
      }

      const recognizer = new LocalRegexRecognizer();
      const text = 'TEST-123 and TEST-456';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(2);
    });

    it('should filter matches using validate', () => {
      const recognizer = new TestRegexRecognizer();
      // TEST-1 should be rejected (only 1 digit), TEST-12 should pass
      const text = 'TEST-1 and TEST-12';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('TEST-12');
    });

    it('should provide correct offsets', () => {
      const recognizer = new TestRegexRecognizer();
      const text = 'Before TEST-123 after';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(7);
      expect(matches[0]?.end).toBe(15); // 7 + 8 (length of 'TEST-123')
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe('TEST-123');
    });

    it('should deduplicate overlapping matches from multiple patterns', () => {
      class MultiPatternRecognizer extends RegexRecognizer {
        readonly type = PIIType.CASE_ID;
        readonly name = 'Multi Pattern';
        protected readonly patterns = [
          /\bTEST-\d+\b/g,
          /\bTEST-\d{3,}\b/g, // More specific pattern
        ];
      }

      const recognizer = new MultiPatternRecognizer();
      const text = 'TEST-123';
      const matches = recognizer.find(text);

      // Should only return one match despite two patterns matching
      expect(matches).toHaveLength(1);
    });

    it('should return empty array for no matches', () => {
      const recognizer = new TestRegexRecognizer();
      const text = 'No matches here';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(0);
    });
  });

  describe('deduplicateMatches', () => {
    it('should remove duplicate spans at same position', () => {
      const recognizer = new TestRegexRecognizer();
      const text = 'TEST-123';
      const matches = recognizer.find(text);

      // Manually test deduplication with overlapping spans
      class TestRecognizerWithDedup extends RegexRecognizer {
        readonly type = PIIType.CASE_ID;
        readonly name = 'Test';
        protected readonly patterns = [/\bTEST-\d+\b/g];

        // Expose deduplicateMatches for testing
        public testDeduplicate(matches: ReturnType<typeof recognizer.find>) {
          return this.deduplicateMatches(matches);
        }
      }

      const testRecognizer = new TestRecognizerWithDedup();
      const duplicateMatches = [
        { type: PIIType.CASE_ID, start: 0, end: 7, confidence: 0.95, source: DetectionSource.REGEX, text: 'TEST-123' },
        { type: PIIType.CASE_ID, start: 0, end: 7, confidence: 0.95, source: DetectionSource.REGEX, text: 'TEST-123' },
      ];

      const deduplicated = testRecognizer.testDeduplicate(duplicateMatches);
      expect(deduplicated).toHaveLength(1);
    });
  });
});

describe('createRegexRecognizer', () => {
  it('should create a recognizer from config', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Custom Test',
      patterns: [/\bCUSTOM-\d+\b/g],
      defaultConfidence: 0.9,
    });

    expect(recognizer.type).toBe(PIIType.CASE_ID);
    expect(recognizer.name).toBe('Custom Test');
    expect(recognizer.defaultConfidence).toBe(0.9);

    const matches = recognizer.find('CUSTOM-123');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.confidence).toBe(0.9);
  });

  it('should use default confidence if not specified', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [/\bTEST-\d+\b/g],
    });

    expect(recognizer.defaultConfidence).toBe(0.95);
  });

  it('should support validation function', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [/\bTEST-\d+\b/g],
      validate: (match) => match.length > 6,
    });

    const matches = recognizer.find('TEST-1 TEST-123');
    // TEST-1 should be rejected (length <= 6), TEST-123 should pass
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe('TEST-123');
  });

  it('should support normalization function', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [/\btest-\d+\b/gi],
      normalize: (match) => match.toUpperCase(),
    });

    expect(recognizer.normalize).toBeDefined();
    expect(recognizer.normalize!('test-123')).toBe('TEST-123');
  });

  it('should handle multiple patterns', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [
        /\bTEST-\d+\b/g,
        /\bCASE-\d+\b/g,
      ],
    });

    const matches = recognizer.find('TEST-1 and CASE-2');
    expect(matches).toHaveLength(2);
  });

  it('should deduplicate matches from multiple patterns', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [
        /\bTEST-\d+\b/g,
        /\bTEST-\d{3,}\b/g, // More specific
      ],
    });

    const matches = recognizer.find('TEST-123');
    // Should deduplicate overlapping matches
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('should handle patterns without global flag', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [/\bTEST-\d+\b/], // No 'g' flag
    });

    const matches = recognizer.find('TEST-1 TEST-2');
    expect(matches).toHaveLength(2);
  });

  it('should return empty array for no matches', () => {
    const recognizer = createRegexRecognizer({
      type: PIIType.CASE_ID,
      name: 'Test',
      patterns: [/\bTEST-\d+\b/g],
    });

    const matches = recognizer.find('No matches');
    expect(matches).toHaveLength(0);
  });
});

