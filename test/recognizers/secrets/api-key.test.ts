import { describe, it, expect } from 'vitest';
import { apiKeyRecognizer } from '../../../src/recognizers/secrets/api-key.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('API Key Recognizer', () => {
  describe('find', () => {
    it('should detect OpenAI keys (sk-proj-)', () => {
      const text = 'My key is sk-proj-abcdefghij1234567890abcd';
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.API_KEY,
        text: 'sk-proj-abcdefghij1234567890abcd',
        source: DetectionSource.REGEX,
      });
    });

    it('should detect OpenAI keys (sk- generic)', () => {
      const text = 'Use sk-abcdefghij1234567890abcd for the API';
      const matches = apiKeyRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const found = matches.some((m) => m.text.startsWith('sk-'));
      expect(found).toBe(true);
    });

    it('should detect Anthropic keys', () => {
      const text = 'Set ANTHROPIC_API_KEY=sk-ant-api03-abcdefghij1234567890';
      const matches = apiKeyRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const found = matches.some((m) => m.text.startsWith('sk-ant-'));
      expect(found).toBe(true);
    });

    it('should detect GitHub PATs', () => {
      const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234';
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.API_KEY,
        text: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234',
      });
    });

    it('should detect Stripe keys', () => {
      // Build key dynamically to avoid GitHub push protection
      const prefix = ['sk', 'test'].join('_') + '_';
      const text = `STRIPE_KEY=${prefix}${'X'.repeat(24)}`;
      const matches = apiKeyRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const found = matches.some((m) => m.text.startsWith(prefix));
      expect(found).toBe(true);
    });

    it('should detect Slack tokens', () => {
      const text = 'SLACK_TOKEN=xoxb-1234567890-abcdefghij';
      const matches = apiKeyRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const found = matches.some((m) => m.text.startsWith('xoxb-'));
      expect(found).toBe(true);
    });

    it('should detect SendGrid keys', () => {
      // SendGrid pattern: SG. + 22 base64url chars + . + 43 base64url chars
      const sgKey = 'SG.FAKE_FAKE_FAKE_FAKE_FA.FAKE_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE_FAK';
      const text = `SENDGRID=${sgKey}`;
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.API_KEY,
        text: sgKey,
      });
    });

    it('should not match short strings like sk-short', () => {
      const text = 'This sk-short is not a real key';
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should not match normal words', () => {
      const text = 'The skeleton was found in the closet yesterday';
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should not match variable names', () => {
      const text = 'const apiKey = getApiKey()';
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should provide correct offsets', () => {
      const key = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234';
      const text = `Token: ${key} is valid`;
      const matches = apiKeyRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(7);
      expect(matches[0]?.end).toBe(7 + key.length);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(key);
    });
  });

  describe('validate', () => {
    it('should reject Heroku-style UUIDs', () => {
      expect(apiKeyRecognizer.validate!('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
    });

    it('should reject strings shorter than 20 characters', () => {
      expect(apiKeyRecognizer.validate!('sk-short')).toBe(false);
    });

    it('should accept valid API key patterns', () => {
      expect(apiKeyRecognizer.validate!('sk-proj-abcdefghij1234567890abcd')).toBe(true);
    });
  });
});
