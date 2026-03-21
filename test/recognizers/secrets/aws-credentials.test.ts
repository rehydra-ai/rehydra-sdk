import { describe, it, expect } from 'vitest';
import { awsCredentialsRecognizer } from '../../../src/recognizers/secrets/aws-credentials.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('AWS Credentials Recognizer', () => {
  describe('find', () => {
    it('should detect AKIA access keys', () => {
      const text = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
      const matches = awsCredentialsRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const akiaMatch = matches.find((m) => m.text === 'AKIAIOSFODNN7EXAMPLE');
      expect(akiaMatch).toBeDefined();
      expect(akiaMatch).toMatchObject({
        type: PIIType.AWS_CREDENTIALS,
        text: 'AKIAIOSFODNN7EXAMPLE',
        source: DetectionSource.REGEX,
      });
    });

    it('should detect AKIA keys without surrounding context', () => {
      const text = 'Key: AKIAIOSFODNN7EXAMPLE';
      const matches = awsCredentialsRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('AKIAIOSFODNN7EXAMPLE');
    });

    it('should detect secret keys when context keyword is present', () => {
      const text = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const matches = awsCredentialsRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const secretMatch = matches.find(
        (m) => m.text === 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      );
      expect(secretMatch).toBeDefined();
      expect(secretMatch).toMatchObject({
        type: PIIType.AWS_CREDENTIALS,
        source: DetectionSource.REGEX,
      });
    });

    it('should NOT detect 40-char base64 strings without AWS context', () => {
      // This text has no AWS-related keywords
      const text = 'random_value = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const matches = awsCredentialsRecognizer.find(text);

      // Should not find the 40-char string because there is no aws_secret context
      const secretMatch = matches.find(
        (m) => m.text === 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      );
      expect(secretMatch).toBeUndefined();
    });

    it('should detect both access key and secret key in the same text', () => {
      const text = `aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`;
      const matches = awsCredentialsRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(2);
      const akiaMatch = matches.find((m) => m.text.startsWith('AKIA'));
      const secretMatch = matches.find((m) => m.text.includes('/'));
      expect(akiaMatch).toBeDefined();
      expect(secretMatch).toBeDefined();
    });

    it('should provide correct offsets for AKIA keys', () => {
      const key = 'AKIAIOSFODNN7EXAMPLE';
      const text = `ID: ${key} here`;
      const matches = awsCredentialsRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(4);
      expect(matches[0]?.end).toBe(4 + key.length);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(key);
    });
  });

  describe('validate', () => {
    it('should validate AKIA access keys', () => {
      expect(awsCredentialsRecognizer.validate!('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    });

    it('should validate 40-char secret keys', () => {
      expect(
        awsCredentialsRecognizer.validate!('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
      ).toBe(true);
    });

    it('should reject keys that are not 20 or 40 chars', () => {
      expect(awsCredentialsRecognizer.validate!('AKIA_SHORT')).toBe(false);
      expect(awsCredentialsRecognizer.validate!('abcdef')).toBe(false);
    });
  });
});
