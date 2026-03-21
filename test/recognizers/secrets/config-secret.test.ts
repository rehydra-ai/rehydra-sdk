import { describe, it, expect } from 'vitest';
import {
  configSecretRecognizer,
  createConfigSecretRecognizer,
} from '../../../src/recognizers/secrets/config-secret.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('Config Secret Recognizer', () => {
  describe('find', () => {
    it('should detect JSON secrets', () => {
      const text = '"password": "s3cret_hunter2"';
      const matches = configSecretRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.CONFIG_SECRET,
        text: 's3cret_hunter2',
        source: DetectionSource.REGEX,
      });
    });

    it('should detect YAML secrets', () => {
      const text = 'api_token: s3cret_hunter2_value';
      const matches = configSecretRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const match = matches.find((m) => m.text.includes('s3cret_hunter2_value'));
      expect(match).toBeDefined();
      expect(match).toMatchObject({
        type: PIIType.CONFIG_SECRET,
      });
    });

    it('should detect TOML secrets', () => {
      const text = 'secret_key = "s3cret_hunter2"';
      const matches = configSecretRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const match = matches.find((m) => m.text === 's3cret_hunter2');
      expect(match).toBeDefined();
    });

    it('should NOT detect non-secret keys', () => {
      const text = '"name": "John Smith"';
      const matches = configSecretRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should NOT detect short values', () => {
      const text = '"password": "abc"';
      const matches = configSecretRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should detect secrets in multiline JSON config', () => {
      const text = `{
  "host": "db.example.com",
  "password": "super-s3cret-pass",
  "port": 5432
}`;
      const matches = configSecretRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const pwMatch = matches.find((m) => m.text === 'super-s3cret-pass');
      expect(pwMatch).toBeDefined();
    });

    it('should detect secrets in multiline YAML config', () => {
      const text = `database:
  host: db.example.com
  password: super-s3cret-pass
  port: 5432`;
      const matches = configSecretRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const pwMatch = matches.find((m) => m.text.includes('super-s3cret-pass'));
      expect(pwMatch).toBeDefined();
    });

    it('should provide correct offsets (value only)', () => {
      const text = '"api_secret": "my_secret_value_123"';
      const matches = configSecretRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const match = matches.find((m) => m.text === 'my_secret_value_123');
      expect(match).toBeDefined();
      expect(text.slice(match!.start, match!.end)).toBe('my_secret_value_123');
    });
  });

  describe('createConfigSecretRecognizer', () => {
    it('should respect custom minValueLength', () => {
      const recognizer = createConfigSecretRecognizer(20);
      const text = '"password": "short1234"';
      const matches = recognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should support extra key patterns', () => {
      const recognizer = createConfigSecretRecognizer(8, [/^my_custom_/i]);
      const text = '"my_custom_field": "this-is-a-custom-secret"';
      const matches = recognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(1);
      const match = matches.find((m) => m.text === 'this-is-a-custom-secret');
      expect(match).toBeDefined();
    });
  });
});
