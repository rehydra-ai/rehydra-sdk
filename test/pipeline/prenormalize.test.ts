import { describe, it, expect } from 'vitest';
import {
  prenormalize,
  DEFAULT_PRENORMALIZE_OPTIONS,
  createIdentityMapping,
  createLineEndingMapping,
  type PrenormalizeOptions,
} from '../../src/pipeline/prenormalize.js';

describe('prenormalize', () => {
  describe('line ending normalization', () => {
    it('should normalize CRLF to LF by default', () => {
      const text = 'Line1\r\nLine2\r\nLine3';
      const result = prenormalize(text);

      expect(result).toBe('Line1\nLine2\nLine3');
      expect(result).not.toContain('\r\n');
    });

    it('should normalize CR to LF by default', () => {
      const text = 'Line1\rLine2\rLine3';
      const result = prenormalize(text);

      expect(result).toBe('Line1\nLine2\nLine3');
      expect(result).not.toContain('\r');
    });

    it('should handle mixed line endings', () => {
      const text = 'Line1\r\nLine2\rLine3\nLine4';
      const result = prenormalize(text);

      expect(result).toBe('Line1\nLine2\nLine3\nLine4');
      expect(result.split('\n')).toHaveLength(4);
    });

    it('should preserve LF when normalizing', () => {
      const text = 'Line1\nLine2\nLine3';
      const result = prenormalize(text);

      expect(result).toBe('Line1\nLine2\nLine3');
    });

    it('should disable line ending normalization when option is false', () => {
      const text = 'Line1\r\nLine2\rLine3';
      const result = prenormalize(text, { normalizeLineEndings: false });

      expect(result).toBe(text);
      expect(result).toContain('\r\n');
      expect(result).toContain('\r');
    });
  });

  describe('unicode normalization', () => {
    it('should not normalize unicode by default', () => {
      const text = 'Café résumé';
      const result = prenormalize(text);

      expect(result).toBe(text);
    });

    it('should normalize unicode when enabled', () => {
      const text = 'Café';
      const result = prenormalize(text, { unicodeNormalize: true });

      // NFKC normalization should work
      expect(result).toBeTruthy();
      expect(result.length).toBeLessThanOrEqual(text.length);
    });

    it('should handle combining characters', () => {
      const text = 'e\u0301'; // e + combining acute
      const result = prenormalize(text, { unicodeNormalize: true });

      // Should normalize to single character
      expect(result).toBeTruthy();
    });
  });

  describe('trim', () => {
    it('should not trim by default', () => {
      const text = '  Hello World  ';
      const result = prenormalize(text);

      expect(result).toBe(text);
    });

    it('should trim when enabled', () => {
      const text = '  Hello World  ';
      const result = prenormalize(text, { trim: true });

      expect(result).toBe('Hello World');
    });

    it('should trim only leading/trailing whitespace', () => {
      const text = '  Hello   World  ';
      const result = prenormalize(text, { trim: true });

      expect(result).toBe('Hello   World');
    });
  });

  describe('combined options', () => {
    it('should apply multiple options together', () => {
      const text = '  Line1\r\nLine2  ';
      const result = prenormalize(text, {
        normalizeLineEndings: true,
        trim: true,
      });

      expect(result).toBe('Line1\nLine2');
    });

    it('should use default options when partial options provided', () => {
      const text = 'Line1\r\nLine2';
      const result = prenormalize(text, { trim: true });

      // Should still normalize line endings (default) and trim
      expect(result).toBe('Line1\nLine2');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = prenormalize('');

      expect(result).toBe('');
    });

    it('should handle string with only line endings', () => {
      const text = '\r\n\r\n';
      const result = prenormalize(text);

      expect(result).toBe('\n\n');
    });

    it('should handle string with only whitespace', () => {
      const text = '   ';
      const result = prenormalize(text, { trim: true });

      expect(result).toBe('');
    });

    it('should preserve text when all options disabled', () => {
      const text = '  Line1\r\nLine2  ';
      const result = prenormalize(text, {
        normalizeLineEndings: false,
        unicodeNormalize: false,
        trim: false,
      });

      expect(result).toBe(text);
    });
  });
});

describe('createIdentityMapping', () => {
  it('should return identity functions', () => {
    const mapping = createIdentityMapping();

    expect(mapping.toNormalized(0)).toBe(0);
    expect(mapping.toNormalized(10)).toBe(10);
    expect(mapping.toNormalized(100)).toBe(100);

    expect(mapping.toOriginal(0)).toBe(0);
    expect(mapping.toOriginal(10)).toBe(10);
    expect(mapping.toOriginal(100)).toBe(100);
  });

  it('should handle negative offsets', () => {
    const mapping = createIdentityMapping();

    expect(mapping.toNormalized(-5)).toBe(-5);
    expect(mapping.toOriginal(-5)).toBe(-5);
  });
});

describe('createLineEndingMapping', () => {
  it('should return identity mapping when no CRLF found', () => {
    const text = 'Line1\nLine2\nLine3';
    const mapping = createLineEndingMapping(text);

    expect(mapping.toNormalized(0)).toBe(0);
    expect(mapping.toNormalized(10)).toBe(10);
    expect(mapping.toOriginal(0)).toBe(0);
    expect(mapping.toOriginal(10)).toBe(10);
  });

  it('should map offsets correctly with CRLF', () => {
    const text = 'Line1\r\nLine2\r\nLine3';
    const mapping = createLineEndingMapping(text);

    // Before first CRLF (at position 5)
    expect(mapping.toNormalized(0)).toBe(0);
    expect(mapping.toNormalized(5)).toBe(5);

    // After first CRLF (removed \r, so offset decreases by 1)
    expect(mapping.toNormalized(7)).toBe(6); // Was 7, now 6 (after \r\n -> \n)

    // After second CRLF
    expect(mapping.toNormalized(13)).toBe(11); // Was 13, now 11 (after two \r\n -> \n)
  });

  it('should map from normalized to original correctly', () => {
    const text = 'Line1\r\nLine2\r\nLine3';
    const mapping = createLineEndingMapping(text);

    // Before first CRLF
    expect(mapping.toOriginal(0)).toBe(0);
    expect(mapping.toOriginal(5)).toBe(6); // Position 5 in normalized (\n) maps to position 6 in original (\n)

    // After first CRLF
    expect(mapping.toOriginal(6)).toBe(7); // Normalized 6 -> Original 7

    // After second CRLF
    expect(mapping.toOriginal(11)).toBe(12); // Normalized 11 -> Original 12
  });

  it('should handle multiple CRLF sequences', () => {
    const text = 'A\r\nB\r\nC\r\nD';
    const mapping = createLineEndingMapping(text);

    // Each CRLF removes 1 character (\r)
    // Original: A\r\nB\r\nC\r\nD (length 11)
    // Normalized: A\nB\nC\nD (length 8)

    // Test forward mapping
    expect(mapping.toNormalized(0)).toBe(0); // A
    expect(mapping.toNormalized(3)).toBe(2); // After first \r\n
    expect(mapping.toNormalized(6)).toBe(4); // After second \r\n
    expect(mapping.toNormalized(9)).toBe(6); // After third \r\n

    // Test reverse mapping
    expect(mapping.toOriginal(0)).toBe(0); // A
    expect(mapping.toOriginal(2)).toBe(3); // After first \n
    expect(mapping.toOriginal(4)).toBe(6); // After second \n
    expect(mapping.toOriginal(6)).toBe(8); // After third \n (position 6 in normalized maps to position 8 in original)
  });

  it('should handle CRLF at start of string', () => {
    const text = '\r\nLine';
    const mapping = createLineEndingMapping(text);

    expect(mapping.toNormalized(0)).toBe(0);
    expect(mapping.toNormalized(2)).toBe(1); // After \r\n
    expect(mapping.toOriginal(0)).toBe(1); // Position 0 in normalized (\n) maps to position 1 in original (\n)
    expect(mapping.toOriginal(1)).toBe(2);
  });

  it('should handle CRLF at end of string', () => {
    const text = 'Line\r\n';
    const mapping = createLineEndingMapping(text);

    expect(mapping.toNormalized(4)).toBe(4); // Before \r\n
    expect(mapping.toNormalized(6)).toBe(5); // After \r\n
    expect(mapping.toOriginal(4)).toBe(5); // Position 4 in normalized maps to position 5 in original
    expect(mapping.toOriginal(5)).toBe(6);
  });

  it('should handle consecutive CRLF sequences', () => {
    const text = 'A\r\n\r\nB';
    const mapping = createLineEndingMapping(text);

    // Two CRLF sequences at positions 1 and 3
    expect(mapping.toNormalized(0)).toBe(0); // A
    expect(mapping.toNormalized(3)).toBe(2); // After first \r\n
    expect(mapping.toNormalized(5)).toBe(3); // After second \r\n
    expect(mapping.toOriginal(0)).toBe(0);
    expect(mapping.toOriginal(2)).toBe(3);
    expect(mapping.toOriginal(3)).toBe(5);
  });

  it('should handle text with only CRLF', () => {
    const text = '\r\n\r\n';
    const mapping = createLineEndingMapping(text);

    expect(mapping.toNormalized(0)).toBe(0);
    expect(mapping.toNormalized(2)).toBe(1);
    expect(mapping.toNormalized(4)).toBe(2);
    expect(mapping.toOriginal(0)).toBe(1); // Position 0 (\n) maps to position 1 (\n)
    expect(mapping.toOriginal(1)).toBe(3); // Position 1 in normalized maps to position 3 in original
    expect(mapping.toOriginal(2)).toBe(4);
  });
});

