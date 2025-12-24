import { describe, it, expect } from 'vitest';
import {
  validateLuhn,
  calculateLuhnCheckDigit,
  validateIBAN,
  normalizeIBAN,
  spansOverlap,
  spanContains,
  spanLength,
  getSpanText,
  sortSpansByPosition,
  sortSpansByPositionDescending,
  removeOverlappingSpans,
  validateNoOverlaps,
  buildOffsetAdjustments,
} from '../../src/utils/index.js';

describe('Utils Index Exports', () => {
  describe('Luhn utilities', () => {
    it('should export validateLuhn', () => {
      expect(typeof validateLuhn).toBe('function');
      expect(validateLuhn('4111111111111111')).toBe(true);
    });

    it('should export calculateLuhnCheckDigit', () => {
      expect(typeof calculateLuhnCheckDigit).toBe('function');
    });
  });

  describe('IBAN utilities', () => {
    it('should export validateIBAN', () => {
      expect(typeof validateIBAN).toBe('function');
      expect(validateIBAN('DE89370400440532013000')).toBe(true);
    });

    it('should export normalizeIBAN', () => {
      expect(typeof normalizeIBAN).toBe('function');
      expect(normalizeIBAN('DE89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
    });
  });

  describe('Offset utilities', () => {
    it('should export spansOverlap', () => {
      expect(typeof spansOverlap).toBe('function');
      expect(spansOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
    });

    it('should export spanContains', () => {
      expect(typeof spanContains).toBe('function');
      expect(spanContains({ start: 0, end: 20 }, { start: 5, end: 15 })).toBe(true);
    });

    it('should export spanLength', () => {
      expect(typeof spanLength).toBe('function');
      expect(spanLength({ start: 0, end: 10 })).toBe(10);
    });

    it('should export getSpanText', () => {
      expect(typeof getSpanText).toBe('function');
      expect(getSpanText('Hello', { start: 0, end: 5 })).toBe('Hello');
    });

    it('should export sortSpansByPosition', () => {
      expect(typeof sortSpansByPosition).toBe('function');
    });

    it('should export sortSpansByPositionDescending', () => {
      expect(typeof sortSpansByPositionDescending).toBe('function');
    });

    it('should export removeOverlappingSpans', () => {
      expect(typeof removeOverlappingSpans).toBe('function');
    });

    it('should export validateNoOverlaps', () => {
      expect(typeof validateNoOverlaps).toBe('function');
      expect(validateNoOverlaps([{ start: 0, end: 5 }, { start: 10, end: 15 }])).toBe(true);
    });

    it('should export buildOffsetAdjustments', () => {
      expect(typeof buildOffsetAdjustments).toBe('function');
    });
  });
});

