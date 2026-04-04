import { describe, it, expect } from 'vitest';
import { dateRecognizer } from '../../src/recognizers/date.js';
import { PIIType, DetectionSource } from '../../src/types/index.js';

describe('Date Recognizer', () => {
  describe('find', () => {
    // --- ISO format ---
    it('should detect ISO dates (YYYY-MM-DD)', () => {
      const text = 'The meeting is on 2024-03-15 at noon.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.DATE,
        text: '2024-03-15',
        source: DetectionSource.REGEX,
      });
    });

    it('should detect ISO dates with slashes', () => {
      const text = 'Date: 2024/01/31';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('2024/01/31');
    });

    // --- EU dot format ---
    it('should detect EU dot dates (DD.MM.YYYY)', () => {
      const text = 'Geburtstag: 15.03.2024';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('15.03.2024');
    });

    // --- US format ---
    it('should detect US dates (MM/DD/YYYY)', () => {
      const text = 'Filed on 03/15/2024 by the applicant.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('03/15/2024');
    });

    it('should detect US dates with dashes', () => {
      const text = 'Date: 12-25-2023';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('12-25-2023');
    });

    // --- EU slash format (day > 12 disambiguates) ---
    it('should detect EU slash dates when day > 12', () => {
      const text = 'Submitted 25/12/2023 for review.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('25/12/2023');
    });

    // --- Written formats ---
    it('should detect written dates (Month DD, YYYY)', () => {
      const text = 'He was born on March 15, 2024.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('March 15, 2024');
    });

    it('should detect written dates with short month', () => {
      const text = 'Due by Jan 5, 2025.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('Jan 5, 2025');
    });

    it('should detect written dates with ordinal suffix', () => {
      const text = 'Meeting on March 1st, 2024.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('March 1st, 2024');
    });

    it('should detect day-first written dates (DD Month YYYY)', () => {
      const text = 'Contract signed 15 March 2024.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('15 March 2024');
    });

    it('should detect day-first written dates with ordinal suffix', () => {
      const text = 'Effective 1st January 2025.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('1st January 2025');
    });

    // --- Multiple dates ---
    it('should detect multiple dates in one text', () => {
      const text = 'From 2024-01-01 to 2024-12-31.';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(2);
      expect(matches[0]?.text).toBe('2024-01-01');
      expect(matches[1]?.text).toBe('2024-12-31');
    });

    // --- Correct offsets ---
    it('should provide correct offsets', () => {
      const text = 'Date: 2024-06-01 here';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(6);
      expect(matches[0]?.end).toBe(16);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe('2024-06-01');
    });

    // --- Case insensitivity ---
    it('should detect written dates case-insensitively', () => {
      const text = 'MARCH 15, 2024 and january 1, 2025';
      const matches = dateRecognizer.find(text);

      expect(matches).toHaveLength(2);
    });
  });

  describe('validation / false positives', () => {
    it('should not match invalid month', () => {
      const text = 'Value 2024-13-01 is not a date.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });

    it('should not match invalid day', () => {
      const text = 'Value 2024-02-30 is not a date.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });

    it('should not match Feb 29 on non-leap year', () => {
      const text = 'Date 2023-02-29 is invalid.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });

    it('should match Feb 29 on leap year', () => {
      const text = 'Date 2024-02-29 is valid.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(1);
    });

    it('should not match IP addresses', () => {
      const text = 'Server at 192.168.01.01 responded.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });

    it('should not match version numbers', () => {
      const text = 'Version 2024.03.15.1 released.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });

    it('should not match years out of range', () => {
      const text = 'In year 1800-01-01 and 2100-06-15.';
      const matches = dateRecognizer.find(text);
      expect(matches).toHaveLength(0);
    });
  });

  describe('normalize', () => {
    it('should trim whitespace', () => {
      expect(dateRecognizer.normalize!('  2024-03-15  ')).toBe('2024-03-15');
    });
  });
});
