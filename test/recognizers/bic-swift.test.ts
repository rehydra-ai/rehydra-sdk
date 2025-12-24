import { describe, it, expect } from 'vitest';
import { bicSwiftRecognizer } from '../../src/recognizers/bic-swift.js';
import { PIIType, DetectionSource } from '../../src/types/index.js';

describe('BIC/SWIFT Recognizer', () => {
  describe('find', () => {
    it('should detect 8-character BIC codes', () => {
      const text = 'Bank code: DEUTDEFF';
      const matches = bicSwiftRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.BIC_SWIFT,
        text: 'DEUTDEFF',
        source: DetectionSource.REGEX,
        confidence: 0.95,
      });
    });

    it('should detect 11-character BIC codes with branch', () => {
      const text = 'BIC: DEUTDEFF500';
      const matches = bicSwiftRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('DEUTDEFF500');
    });

    it('should detect multiple BIC codes', () => {
      const text = 'Bank1: DEUTDEFF, Bank2: COBADEFF';
      const matches = bicSwiftRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('should provide correct offsets', () => {
      const text = 'BIC code DEUTDEFF here';
      const matches = bicSwiftRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(9);
      expect(matches[0]?.end).toBe(17);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe('DEUTDEFF');
    });

    it('should only return validated BIC codes', () => {
      // Invalid country code
      const text = 'Invalid: XXXXZZ99';
      const matches = bicSwiftRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should handle BIC codes at word boundaries', () => {
      const text = 'BICDEUTDEFF123'; // Should not match (no word boundary)
      const matches = bicSwiftRecognizer.find(text);

      // Should not match because DEUTDEFF is not at word boundary
      expect(matches).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('should validate correct 8-character BIC', () => {
      expect(bicSwiftRecognizer.validate!('DEUTDEFF')).toBe(true);
      expect(bicSwiftRecognizer.validate!('COBADEFF')).toBe(true);
      expect(bicSwiftRecognizer.validate!('UBSWCHZH')).toBe(true);
    });

    it('should validate correct 11-character BIC with branch', () => {
      expect(bicSwiftRecognizer.validate!('DEUTDEFF500')).toBe(true);
      expect(bicSwiftRecognizer.validate!('COBADEFFXXX')).toBe(true);
    });

    it('should reject BIC with wrong length', () => {
      expect(bicSwiftRecognizer.validate!('DEUTDE')).toBe(false); // Too short
      expect(bicSwiftRecognizer.validate!('DEUTDEFF5')).toBe(false); // 9 chars
      expect(bicSwiftRecognizer.validate!('DEUTDEFF5000')).toBe(false); // 12 chars
    });

    it('should reject BIC with invalid country code', () => {
      expect(bicSwiftRecognizer.validate!('DEUTZZFF')).toBe(false); // ZZ not valid
      expect(bicSwiftRecognizer.validate!('DEUT00FF')).toBe(false); // 00 not valid
    });

    it('should reject BIC with invalid bank code (must be letters)', () => {
      expect(bicSwiftRecognizer.validate!('DEU1DEFF')).toBe(false); // Number in bank code
      expect(bicSwiftRecognizer.validate!('DEU-DEFF')).toBe(false); // Special char
    });

    it('should reject BIC with invalid location code', () => {
      expect(bicSwiftRecognizer.validate!('DEUTDE--')).toBe(false); // Invalid chars
    });

    it('should reject BIC with invalid branch code', () => {
      expect(bicSwiftRecognizer.validate!('DEUTDEFF--')).toBe(false); // Invalid chars
    });

    it('should be case-insensitive for validation', () => {
      expect(bicSwiftRecognizer.validate!('deutdeff')).toBe(true);
      expect(bicSwiftRecognizer.validate!('DeUtDeFf')).toBe(true);
      expect(bicSwiftRecognizer.validate!('DEUTDEFF500')).toBe(true);
    });

    it('should validate various country codes', () => {
      // Test a few different countries
      expect(bicSwiftRecognizer.validate!('DEUTDEFF')).toBe(true); // Germany
      expect(bicSwiftRecognizer.validate!('CHASUS33')).toBe(true); // USA
      expect(bicSwiftRecognizer.validate!('HSBCGB2L')).toBe(true); // UK
      expect(bicSwiftRecognizer.validate!('BNPAFRPP')).toBe(true); // France
    });
  });

  describe('normalize', () => {
    it('should uppercase and trim BIC codes', () => {
      expect(bicSwiftRecognizer.normalize!('  deutdeff  ')).toBe('DEUTDEFF');
      expect(bicSwiftRecognizer.normalize!('deutdeff500')).toBe('DEUTDEFF500');
    });

    it('should handle already uppercase BIC', () => {
      expect(bicSwiftRecognizer.normalize!('DEUTDEFF')).toBe('DEUTDEFF');
    });

    it('should handle mixed case BIC', () => {
      expect(bicSwiftRecognizer.normalize!('DeUtDeFf')).toBe('DEUTDEFF');
    });
  });

  describe('integration', () => {
    it('should find and validate real-world BIC codes', () => {
      const realBics = [
        'DEUTDEFF', // Deutsche Bank
        'COBADEFF', // Commerzbank
        'UBSWCHZH', // UBS Switzerland
        'HSBCGB2L', // HSBC UK
      ];

      for (const bic of realBics) {
        const text = `BIC: ${bic}`;
        const matches = bicSwiftRecognizer.find(text);

        expect(matches.length).toBeGreaterThanOrEqual(1);
        if (matches.length > 0) {
          expect(matches[0]?.text.toUpperCase()).toBe(bic);
        }
      }
    });

    it('should not match similar patterns that are not BIC codes', () => {
      const invalidPatterns = [
        'DEUTDEFF12345', // Too long
        'DEUTDE', // Too short
        'DEUT1234', // Numbers in bank code
        'XXXXZZ99', // Invalid country
      ];

      for (const pattern of invalidPatterns) {
        const matches = bicSwiftRecognizer.find(`Code: ${pattern}`);
        expect(matches).toHaveLength(0);
      }
    });
  });
});

