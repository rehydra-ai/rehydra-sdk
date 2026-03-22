import { describe, it, expect } from 'vitest';
import { createLiteralValueRecognizer } from '../../../src/recognizers/secrets/literal-value.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('Literal Value Recognizer', () => {
  describe('find', () => {
    it('should find exact value occurrences in text', () => {
      const recognizer = createLiteralValueRecognizer(['my-secret-value-1234']);
      const text = 'The config contains my-secret-value-1234 as the key.';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.ENV_VAR_SECRET,
        text: 'my-secret-value-1234',
        source: DetectionSource.REGEX,
      });
    });

    it('should filter out short values', () => {
      const recognizer = createLiteralValueRecognizer(['abc', 'ab', 'my-long-secret-value']);
      const text = 'abc ab my-long-secret-value';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('my-long-secret-value');
    });

    it('should filter out common values', () => {
      const recognizer = createLiteralValueRecognizer([
        'true',
        'false',
        'localhost',
        'production',
        'development',
        'my-actual-secret-12',
      ]);
      const text = 'true false localhost production development my-actual-secret-12';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('my-actual-secret-12');
    });

    it('should handle multiple occurrences of the same value', () => {
      const recognizer = createLiteralValueRecognizer(['secret-token-value1']);
      const text = 'first: secret-token-value1, second: secret-token-value1';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(2);
      expect(matches[0]?.text).toBe('secret-token-value1');
      expect(matches[1]?.text).toBe('secret-token-value1');
    });

    it('should have correct offsets', () => {
      const value = 'super-secret-password-123';
      const recognizer = createLiteralValueRecognizer([value]);
      const text = `Key: ${value} done`;
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(5);
      expect(matches[0]?.end).toBe(5 + value.length);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(value);
    });

    it('should respect custom minLength', () => {
      const recognizer = createLiteralValueRecognizer(['abcde12345'], 12);
      const text = 'value: abcde12345';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should find multiple different values', () => {
      const recognizer = createLiteralValueRecognizer([
        'first-secret-value-1',
        'second-secret-value2',
      ]);
      const text = 'A: first-secret-value-1, B: second-secret-value2';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(2);
    });

    it('should return empty array for no values provided', () => {
      const recognizer = createLiteralValueRecognizer([]);
      const text = 'some text with nothing to find';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should have confidence of 1.0', () => {
      const recognizer = createLiteralValueRecognizer(['known-secret-val-12']);
      const text = 'the known-secret-val-12 here';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidence).toBe(1.0);
    });
  });
});
