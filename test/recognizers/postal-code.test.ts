import { describe, expect, it } from 'vitest';
import {
  isValidUKPostalCode,
  normalizeUKPostalCode,
  ukPostalCodeRecognizer,
} from '../../src/recognizers/postal-code.js';
import { DetectionSource, PIIType } from '../../src/types/index.js';

describe('UK Postal Code Recognizer', () => {
  describe('find', () => {
    it.each([
      'M1 1AE',
      'B33 8TH',
      'CR2 6XH',
      'DN55 1PT',
      'W1A 1HQ',
      'EC1A 1BB',
      'N16 4HY',
      'GIR 0AA',
    ])('should detect the valid postcode %s', (postalCode) => {
      const matches = ukPostalCodeRecognizer.find(`Postcode: ${postalCode}`);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.POSTAL_CODE,
        text: postalCode,
        source: DetectionSource.REGEX,
        confidence: 0.95,
      });
    });

    it('should detect lowercase postcodes', () => {
      const matches = ukPostalCodeRecognizer.find('Send it to n16 4hy today');

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('n16 4hy');
    });

    it('should detect postcodes without a space', () => {
      const matches = ukPostalCodeRecognizer.find('Postcode: EC1A1BB');

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('EC1A1BB');
    });

    it('should allow multiple horizontal spaces without crossing lines', () => {
      expect(ukPostalCodeRecognizer.find('Postcode: N16   4HY')).toHaveLength(1);
      expect(ukPostalCodeRecognizer.find('Codes: N16\n4HY')).toHaveLength(0);
    });

    it('should detect multiple postcodes with correct offsets', () => {
      const text = 'From N16 4HY to SW1A 1AA';
      const matches = ukPostalCodeRecognizer.find(text);

      expect(matches.map((match) => match.text)).toEqual(['N16 4HY', 'SW1A 1AA']);
      for (const match of matches) {
        expect(text.slice(match.start, match.end)).toBe(match.text);
      }
    });

    it.each([
      'Flat 1',
      'GIR 1AA',
      'GIR 0AB',
      'N16 4CI',
      'Q1 1AA',
      'N1 1A',
      'EC1A-1BB',
      '12345',
    ])('should not detect the invalid postcode-like value %s', (value) => {
      expect(ukPostalCodeRecognizer.find(`Value: ${value}`)).toHaveLength(0);
    });

    it('should not match inside a longer identifier', () => {
      expect(ukPostalCodeRecognizer.find('refN16 4HYmore')).toHaveLength(0);
      expect(ukPostalCodeRecognizer.find('ABCN164HYZ')).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('should validate supported UK postcode syntax', () => {
      expect(isValidUKPostalCode('N16 4HY')).toBe(true);
      expect(isValidUKPostalCode('n164hy')).toBe(true);
      expect(isValidUKPostalCode(' GIR 0AA ')).toBe(true);
    });

    it('should reject invalid inward-code letters', () => {
      expect(isValidUKPostalCode('N16 4CI')).toBe(false);
      expect(isValidUKPostalCode('N16 4MV')).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should uppercase and insert one space before the inward code', () => {
      expect(normalizeUKPostalCode('n164hy')).toBe('N16 4HY');
      expect(normalizeUKPostalCode(' ec1a   1bb ')).toBe('EC1A 1BB');
      expect(normalizeUKPostalCode('gir0aa')).toBe('GIR 0AA');
    });
  });
});
