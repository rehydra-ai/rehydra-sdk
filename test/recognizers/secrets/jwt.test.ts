import { describe, it, expect } from 'vitest';
import { jwtRecognizer } from '../../../src/recognizers/secrets/jwt.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('JWT Recognizer', () => {
  const validJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

  describe('find', () => {
    it('should detect a valid JWT', () => {
      const text = `Bearer ${validJwt}`;
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.JWT,
        text: validJwt,
        source: DetectionSource.REGEX,
      });
    });

    it('should detect JWT in a longer text', () => {
      const text = `The token is ${validJwt} and it expires soon.`;
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe(validJwt);
    });

    it('should not match random base64 strings', () => {
      const text = 'Here is some base64: dGVzdGluZzEyMw== and more text';
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should not match partial JWTs with missing segment', () => {
      // Only two segments instead of three
      const text = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
      const matches = jwtRecognizer.find(text);

      // The regex requires three dot-separated segments, so this should not match
      expect(matches).toHaveLength(0);
    });

    it('should not match strings that do not start with eyJ', () => {
      const text = 'abc.def.ghi is not a JWT';
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should provide correct offsets', () => {
      const prefix = 'Authorization: Bearer ';
      const text = `${prefix}${validJwt}`;
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(prefix.length);
      expect(matches[0]?.end).toBe(prefix.length + validJwt.length);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(validJwt);
    });

    it('should detect multiple JWTs in the same text', () => {
      const text = `First: ${validJwt} Second: ${validJwt}`;
      const matches = jwtRecognizer.find(text);

      expect(matches).toHaveLength(2);
    });
  });

  describe('validate', () => {
    it('should verify alg field in header', () => {
      expect(jwtRecognizer.validate!(validJwt)).toBe(true);
    });

    it('should reject JWT with missing alg in header', () => {
      // eyJ0eXAiOiJKV1QifQ == {"typ":"JWT"} (no alg)
      const noAlg = 'eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmno';
      expect(jwtRecognizer.validate!(noAlg)).toBe(false);
    });

    it('should reject non-JSON header', () => {
      // Random base64url that does not decode to valid JSON
      const invalid = 'eyJpbnZhbGlk.eyJzdWIiOiIxMjM0In0.abcdefghijklmno';
      // This may or may not parse depending on padding; if it does parse,
      // it lacks an alg field
      const result = jwtRecognizer.validate!(invalid);
      // Either it fails to parse JSON (false) or it has no alg (false)
      expect(result).toBe(false);
    });

    it('should reject string that is not three segments', () => {
      expect(jwtRecognizer.validate!('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0')).toBe(false);
    });
  });
});
