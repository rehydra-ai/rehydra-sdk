import { describe, it, expect } from 'vitest';
import {
  envVarSecretRecognizer,
  createEnvVarSecretRecognizer,
} from '../../../src/recognizers/secrets/env-var.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('Env Var Secret Recognizer', () => {
  describe('find', () => {
    it('should detect DATABASE_PASSWORD with long value (value only span)', () => {
      const text = 'DATABASE_PASSWORD=hunter2hunter2';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.ENV_VAR_SECRET,
        text: 'hunter2hunter2',
        source: DetectionSource.REGEX,
      });
    });

    it('should detect export API_KEY=<value>', () => {
      const text = 'export API_KEY=sk-1234567890abcdef';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.ENV_VAR_SECRET,
        text: 'sk-1234567890abcdef',
      });
    });

    it('should detect secret in quoted values', () => {
      const text = 'AUTH_TOKEN="my-super-secret-token-value"';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('my-super-secret-token-value');
    });

    it('should NOT detect short values', () => {
      const text = 'PASSWORD=abc';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should NOT detect non-secret keys', () => {
      const text = 'NODE_ENV=production';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should NOT detect placeholder values', () => {
      const text = 'API_KEY=changeme';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should NOT detect other placeholder values', () => {
      const placeholders = [
        'SECRET=your-api-key-here',
        'TOKEN=your_api_key_here',
        'PASSWORD=placeholder',
        'API_KEY=replace_me',
      ];

      for (const text of placeholders) {
        const matches = envVarSecretRecognizer.find(text);
        expect(matches).toHaveLength(0);
      }
    });

    it('should detect multiple env var secrets in multiline text', () => {
      const text = `DATABASE_PASSWORD=hunter2hunter2
API_KEY=sk-1234567890abcdef
NODE_ENV=production`;
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(2);
    });

    it('should provide correct offsets (value only)', () => {
      const text = 'SECRET_KEY=mysecretvalue12345';
      const matches = envVarSecretRecognizer.find(text);

      expect(matches).toHaveLength(1);
      const value = 'mysecretvalue12345';
      expect(matches[0]?.text).toBe(value);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(value);
    });
  });

  describe('createEnvVarSecretRecognizer', () => {
    it('should respect custom minValueLength', () => {
      const recognizer = createEnvVarSecretRecognizer(20);
      const text = 'PASSWORD=short1234';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should support extra key patterns', () => {
      const recognizer = createEnvVarSecretRecognizer(8, [/^MY_CUSTOM_/i]);
      const text = 'MY_CUSTOM_FIELD=this-is-a-long-value-here';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('this-is-a-long-value-here');
    });
  });
});
