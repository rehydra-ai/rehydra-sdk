import { describe, it, expect } from 'vitest';
import { privateKeyRecognizer } from '../../../src/recognizers/secrets/private-key.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('Private Key Recognizer', () => {
  describe('find', () => {
    it('should detect RSA private key PEM blocks', () => {
      const text = `Here is a key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/yGaXm2LBQJ+bLiE8MFQqVEBbGhOC0mI
hP8R1F6epMjAwnSaL3KMH1FaKE0VTDx3z6ywqXbWQJB7XHZQ1UqKRPRBDkX
-----END RSA PRIVATE KEY-----
That was the key.`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.PRIVATE_KEY,
        source: DetectionSource.REGEX,
      });
      expect(matches[0]?.text).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(matches[0]?.text).toContain('-----END RSA PRIVATE KEY-----');
    });

    it('should detect EC private key PEM blocks', () => {
      const text = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIODsdVh5J4AgWmJFLz3CBs0kxBBQqtjRg8b5MT+HpvL6oAcGBSuBBAAi
oWQDYgAEMuxBBOV7S0JaRqhPDy0u2Po1N9aTIuNyFTlqJXX8Gw3E1b
-----END EC PRIVATE KEY-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.PRIVATE_KEY,
      });
      expect(matches[0]?.text).toContain('-----BEGIN EC PRIVATE KEY-----');
      expect(matches[0]?.text).toContain('-----END EC PRIVATE KEY-----');
    });

    it('should detect OPENSSH private key PEM blocks', () => {
      const text = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBt1Y3FbCw0UKNpyGkRjDmZmFSq/qMEdS/lSN0Dp1gQ
-----END OPENSSH PRIVATE KEY-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.PRIVATE_KEY,
      });
      expect(matches[0]?.text).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
      expect(matches[0]?.text).toContain('-----END OPENSSH PRIVATE KEY-----');
    });

    it('should detect generic private key PEM blocks', () => {
      const text = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7cn6lHfKJ1wfk
-----END PRIVATE KEY-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('-----BEGIN PRIVATE KEY-----');
      expect(matches[0]?.text).toContain('-----END PRIVATE KEY-----');
    });

    it('should not detect public key blocks', () => {
      const text = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn
-----END PUBLIC KEY-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should not detect certificate blocks', () => {
      const text = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAJC1HiIAZAiUMA0Gcz6E8JU3OQ==
-----END CERTIFICATE-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should handle multiline keys correctly', () => {
      const text = `Config:
-----BEGIN RSA PRIVATE KEY-----
AAAA
BBBB
CCCC
DDDD
-----END RSA PRIVATE KEY-----
Done.`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('AAAA');
      expect(matches[0]?.text).toContain('DDDD');
    });

    it('should detect multiple private keys in the same text', () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
AAAA1111
-----END RSA PRIVATE KEY-----
some text in between
-----BEGIN EC PRIVATE KEY-----
BBBB2222
-----END EC PRIVATE KEY-----`;
      const matches = privateKeyRecognizer.find(text);

      expect(matches).toHaveLength(2);
    });
  });
});
