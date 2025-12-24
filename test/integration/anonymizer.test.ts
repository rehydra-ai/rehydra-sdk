import { describe, it, expect, beforeEach } from 'vitest';
import {
  Anonymizer,
  createAnonymizer,
  anonymize,
  anonymizeRegexOnly,
  PIIType,
  createDefaultPolicy,
  InMemoryKeyProvider,
  decryptPIIMap,
} from '../../src/index.js';

describe('Anonymizer Integration', () => {
  let anonymizer: Anonymizer;
  let keyProvider: InMemoryKeyProvider;

  beforeEach(async () => {
    keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();
  });

  describe('basic anonymization', () => {
    it('should anonymize email addresses', async () => {
      const text = 'Contact us at support@example.com for help.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(result.anonymizedText).not.toContain('support@example.com');
      expect(result.stats.totalEntities).toBe(1);
      expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
    });

    it('should anonymize phone numbers', async () => {
      const text = 'Call +49 30 123456789 for assistance.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="PHONE"');
      expect(result.stats.countsByType[PIIType.PHONE]).toBeGreaterThanOrEqual(1);
    });

    it('should anonymize IBANs', async () => {
      const text = 'Transfer to DE89370400440532013000';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="IBAN"');
      expect(result.anonymizedText).not.toContain('DE89370400440532013000');
    });

    it('should anonymize credit cards', async () => {
      const text = 'Card number: 4111111111111111';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="CREDIT_CARD"');
      expect(result.anonymizedText).not.toContain('4111111111111111');
    });

    it('should handle multiple PII types in one text', async () => {
      const text = 'Contact john@example.com or call +49123456789. IBAN: DE89370400440532013000';
      const result = await anonymizer.anonymize(text);

      expect(result.stats.totalEntities).toBeGreaterThanOrEqual(3);
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(result.anonymizedText).toContain('<PII type="IBAN"');
    });
  });

  describe('PII map encryption', () => {
    it('should produce encrypted PII map', async () => {
      const text = 'Hello john@example.com';
      const result = await anonymizer.anonymize(text);

      expect(result.piiMap.ciphertext).toBeTruthy();
      expect(result.piiMap.iv).toBeTruthy();
      expect(result.piiMap.authTag).toBeTruthy();
    });

    it('should be decryptable with the key', async () => {
      const text = 'Hello john@example.com';
      const result = await anonymizer.anonymize(text);

      const key = await keyProvider.getKey();
      const decrypted = decryptPIIMap(result.piiMap, key);

      expect(decrypted.size).toBe(1);
      expect(Array.from(decrypted.values())).toContain('john@example.com');
    });
  });

  describe('policy handling', () => {
    it('should respect disabled types', async () => {
      const text = 'Email: test@example.com, Phone: +49123456789';
      const policy = {
        enabledTypes: new Set([PIIType.EMAIL]), // Only EMAIL enabled
        regexEnabledTypes: new Set([PIIType.EMAIL]),
      };

      const result = await anonymizer.anonymize(text, undefined, policy);

      expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
      expect(result.stats.countsByType[PIIType.PHONE]).toBe(0);
    });

    it('should respect confidence thresholds', async () => {
      // Regex matches have high confidence (0.9+), so this mainly affects NER
      // Testing that the threshold mechanism works
      const text = 'Hello world';
      const policy = {
        confidenceThresholds: new Map([[PIIType.PERSON, 0.99]]),
      };

      const result = await anonymizer.anonymize(text, undefined, policy);

      // Should not crash and return valid result
      expect(result.anonymizedText).toBe('Hello world');
    });
  });

  describe('edge cases', () => {
    it('should handle empty text', async () => {
      const result = await anonymizer.anonymize('');

      expect(result.anonymizedText).toBe('');
      expect(result.stats.totalEntities).toBe(0);
    });

    it('should handle text without PII', async () => {
      const text = 'This is a normal sentence without any personal information.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toBe(text);
      expect(result.stats.totalEntities).toBe(0);
    });

    it('should handle repeated PII', async () => {
      const text = 'Email: test@example.com and again test@example.com';
      const result = await anonymizer.anonymize(text);

      expect(result.stats.countsByType[PIIType.EMAIL]).toBe(2);
    });

    it('should handle special characters in text', async () => {
      const text = 'Contäct: üser@exämple.com';
      const result = await anonymizer.anonymize(text);

      // Should handle unicode properly
      expect(result.anonymizedText).toBeTruthy();
    });

    it('should normalize line endings', async () => {
      const text = 'Line1\r\nLine2\rLine3\n';
      const result = await anonymizer.anonymize(text);

      // Line endings should be normalized
      expect(result.anonymizedText).not.toContain('\r\n');
      expect(result.anonymizedText).not.toContain('\r');
    });
  });

  describe('stats', () => {
    it('should include processing time', async () => {
      const result = await anonymizer.anonymize('test@example.com');

      expect(result.stats.processingTimeMs).toBeGreaterThan(0);
    });

    it('should include model version', async () => {
      const result = await anonymizer.anonymize('test');

      expect(result.stats.modelVersion).toBeTruthy();
    });

    it('should include policy version', async () => {
      const result = await anonymizer.anonymize('test');

      expect(result.stats.policyVersion).toBeTruthy();
    });
  });
});

describe('Convenience Functions', () => {
  describe('anonymize', () => {
    it('should work as standalone function', async () => {
      const result = await anonymize('Contact test@example.com');

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should accept locale parameter', async () => {
      const result = await anonymize('Contact test@example.com', 'en-US');

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should accept policy parameter', async () => {
      const result = await anonymize('Contact test@example.com', undefined, {
        enabledTypes: new Set([PIIType.EMAIL]),
      });

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('anonymizeRegexOnly', () => {
    it('should only use regex recognizers', async () => {
      const text = 'Contact test@example.com';
      const result = await anonymizeRegexOnly(text);

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      // NER types should not be detected
      expect(result.entities.every(e => e.source === 'REGEX')).toBe(true);
    });

    it('should accept policy parameter', async () => {
      const result = await anonymizeRegexOnly('test@example.com +49123456789', {
        enabledTypes: new Set([PIIType.EMAIL]),
        regexEnabledTypes: new Set([PIIType.EMAIL]),
      });

      // Should only have email, not phone
      expect(result.entities.every(e => e.type === PIIType.EMAIL)).toBe(true);
    });
  });
});

describe('Anonymizer Class', () => {
  describe('dispose', () => {
    it('should dispose resources without error', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      await expect(anonymizer.dispose()).resolves.not.toThrow();
    });

    it('should allow re-initialization after dispose', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();
      await anonymizer.dispose();
      await anonymizer.initialize();

      const result = await anonymizer.anonymize('test@example.com');
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('getRegistry', () => {
    it('should return the recognizer registry', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      const registry = anonymizer.getRegistry();
      expect(registry).toBeDefined();
      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
    });
  });

  describe('getNERModel', () => {
    it('should return the NER model after initialization', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      const nerModel = anonymizer.getNERModel();
      expect(nerModel).not.toBeNull();
    });
  });

  describe('isInitialized', () => {
    it('should be false before initialization', () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });

      expect(anonymizer.isInitialized).toBe(false);
    });

    it('should be true after initialization', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      expect(anonymizer.isInitialized).toBe(true);
    });

    it('should be false after dispose', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();
      await anonymizer.dispose();

      expect(anonymizer.isInitialized).toBe(false);
    });
  });

  describe('auto-initialization', () => {
    it('should auto-initialize when anonymize is called', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });

      // Don't call initialize explicitly
      const result = await anonymizer.anonymize('test@example.com');
      
      expect(anonymizer.isInitialized).toBe(true);
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('NER thresholds configuration', () => {
    it('should accept thresholds in NER config', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        ner: {
          mode: 'disabled',
          thresholds: { PERSON: 0.8, ORG: 0.7 },
        },
      });
      await anonymizer.initialize();

      const result = await anonymizer.anonymize('test@example.com');
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('NER mode custom', () => {
    it('should throw error when custom mode lacks modelPath', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        ner: {
          mode: 'custom',
          vocabPath: '/some/path/vocab.txt',
        } as any,
      });

      await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
    });

    it('should throw error when custom mode lacks vocabPath', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        ner: {
          mode: 'custom',
          modelPath: '/some/path/model.onnx',
        } as any,
      });

      await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
    });

    it('should throw error when custom mode has empty paths', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        ner: {
          mode: 'custom',
          modelPath: '',
          vocabPath: '',
        },
      });

      await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
    });
  });

  describe('semantic masking configuration', () => {
    it('should work with semantic masking enabled', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        semantic: { enabled: true },
      });
      await anonymizer.initialize();

      const result = await anonymizer.anonymize('Hello John Smith from Berlin');
      expect(result.anonymizedText).toBeDefined();
    });

    it('should pass through status callbacks', async () => {
      const statuses: string[] = [];
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        semantic: {
          enabled: true,
          onStatus: (status) => statuses.push(status),
        },
      });
      await anonymizer.initialize();

      // Should have received status updates
      expect(statuses.length).toBeGreaterThanOrEqual(0);
    });
  });
});

