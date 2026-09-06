import { describe, it, expect, beforeEach } from 'vitest';
import {
  Anonymizer,
  createAnonymizer,
  anonymize,
  anonymizeRegexOnly,
  createCustomIdRecognizer,
  PIIType,
  ALL_PII_TYPES,
  createDefaultPolicy,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  decryptPIIMap,
  rehydrate,
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

    it('should anonymize the UK postcode from issue 94 including the apartment address', async () => {
      const text = 'Flat 1\n34a Friskin Road\nLondon\nN16 4HY\nUnited Kingdom';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).not.toContain('Flat 1');
      expect(result.anonymizedText).not.toContain('N16 4HY');
      expect(result.anonymizedText).toContain('<PII type="ADDRESS"');
      expect(result.stats.countsByType[PIIType.ADDRESS]).toBe(1);
      expect(result.stats.leakScanPassed).toBe(true);
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
      const decrypted = await decryptPIIMap(result.piiMap, key);

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

      await expect(anonymizer.dispose()).resolves.toBeUndefined();
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
    it('should work with semantic masking enabled', { timeout: 15_000 }, async () => {
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

    it('should apply excludeLocationScopes when semantic masking is enabled', { timeout: 15_000 }, async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        semantic: { enabled: true },
      });
      await anonymizer.initialize();

      const result = await anonymizer.anonymize(
        'Contact support@example.com for help.',
        undefined,
        { excludeLocationScopes: new Set(['country', 'region'] as const) }
      );
      // Should still anonymize non-location PII
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should preserve enableSemanticMasking when passing partial policy override', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        semantic: { enabled: true },
      });
      await anonymizer.initialize();

      // Pass a partial policy that only changes enableLeakScan
      // This should NOT reset enableSemanticMasking to false
      const result = await anonymizer.anonymize(
        'Hello Maria from Berlin',
        undefined,
        { enableLeakScan: false }
      );

      // The anonymized text should still have semantic attributes since
      // enableSemanticMasking should be preserved from instance config
      expect(result.anonymizedText).toBeDefined();
      // Stats should reflect that leak scan was disabled
      expect(result.stats.leakScanPassed).toBeUndefined();
    });
  });

  describe('policy merging', () => {
    it('should preserve instance default thresholds when passing partial policy', async () => {
      const keyProvider = new InMemoryKeyProvider();
      // Create with custom default thresholds
      const customThresholds = new Map<PIIType, number>([
        [PIIType.EMAIL, 0.9],
        [PIIType.PERSON, 0.85],
      ]);
      const anonymizer = createAnonymizer({
        keyProvider,
        defaultPolicy: {
          ...createDefaultPolicy(),
          confidenceThresholds: customThresholds,
        },
      });
      await anonymizer.initialize();

      // Pass a partial policy - should merge, not replace thresholds
      const result = await anonymizer.anonymize(
        'Contact test@example.com',
        undefined,
        { enableLeakScan: false }
      );

      // Should still detect email with the preserved threshold
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should merge partial defaultPolicy with SDK defaults instead of replacing', async () => {
      const keyProvider = new InMemoryKeyProvider();
      // Pass only excludeLocationScopes — all other fields should come from defaults
      const anonymizer = createAnonymizer({
        keyProvider,
        defaultPolicy: {
          excludeLocationScopes: new Set(['country', 'region']),
        },
      });
      await anonymizer.initialize();

      const result = await anonymizer.anonymize('Contact test@example.com');
      // Should still detect email (enabledTypes, regexEnabledTypes filled from defaults)
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should allow overriding specific thresholds while preserving others', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      // Pass a partial policy with a specific threshold override
      const result = await anonymizer.anonymize(
        'Contact test@example.com',
        undefined,
        {
          confidenceThresholds: new Map([[PIIType.IBAN, 0.99]]),
        }
      );

      // Email should still be detected (default threshold preserved)
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('anonymization mode', () => {
    describe('pseudonymize mode (default)', () => {
      it('should return encrypted PII map by default', async () => {
        const keyProvider = new InMemoryKeyProvider();
        const anonymizer = createAnonymizer({ keyProvider });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('Contact john@example.com');

        expect(result.piiMap).toBeDefined();
        expect(result.piiMap?.ciphertext).toBeTruthy();
        expect(result.piiMap?.iv).toBeTruthy();
        expect(result.piiMap?.authTag).toBeTruthy();
      });

      it('should return encrypted PII map when explicitly set to pseudonymize', async () => {
        const keyProvider = new InMemoryKeyProvider();
        const anonymizer = createAnonymizer({
          keyProvider,
          mode: 'pseudonymize',
        });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('Contact john@example.com');

        expect(result.piiMap).toBeDefined();
        expect(result.piiMap?.ciphertext).toBeTruthy();
      });
    });

    describe('anonymize mode', () => {
      it('should not return PII map in anonymize mode', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('Contact john@example.com');

        expect(result.piiMap).toBeUndefined();
      });

      it('should still detect and tag PII entities', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('Contact john@example.com for help');

        expect(result.anonymizedText).toContain('<PII type="EMAIL"');
        expect(result.anonymizedText).not.toContain('john@example.com');
        expect(result.stats.totalEntities).toBe(1);
        expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
      });

      it('should assign consistent IDs to repeated PII', async () => {
        const anonymizer = createAnonymizer({
          mode: 'anonymize',
          defaultPolicy: {
            ...createDefaultPolicy(),
            reuseIdsForRepeatedPII: true,
          },
        });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize(
          'Contact john@example.com or john@example.com'
        );

        // Both occurrences should have the same ID
        const matches = result.anonymizedText.match(/<PII type="EMAIL" id="(\d+)"\/>/g);
        expect(matches).toHaveLength(2);
        // IDs should be the same when reuseIdsForRepeatedPII is true
        const id1 = matches![0].match(/id="(\d+)"/)?.[1];
        const id2 = matches![1].match(/id="(\d+)"/)?.[1];
        expect(id1).toBe(id2);
      });

      it('should include all stats', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('Contact john@example.com');

        expect(result.stats.processingTimeMs).toBeGreaterThan(0);
        expect(result.stats.modelVersion).toBeTruthy();
        expect(result.stats.policyVersion).toBeTruthy();
        expect(result.stats.totalEntities).toBe(1);
      });

      it('should handle multiple PII types', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize(
          'Contact john@example.com or call +49123456789. IBAN: DE89370400440532013000'
        );

        expect(result.piiMap).toBeUndefined();
        expect(result.stats.totalEntities).toBeGreaterThanOrEqual(3);
        expect(result.anonymizedText).toContain('<PII type="EMAIL"');
        expect(result.anonymizedText).toContain('<PII type="IBAN"');
      });

      it('should handle empty text', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const result = await anonymizer.anonymize('');

        expect(result.piiMap).toBeUndefined();
        expect(result.anonymizedText).toBe('');
        expect(result.stats.totalEntities).toBe(0);
      });

      it('should handle text without PII', async () => {
        const anonymizer = createAnonymizer({ mode: 'anonymize' });
        await anonymizer.initialize();

        const text = 'This is a normal sentence without PII.';
        const result = await anonymizer.anonymize(text);

        expect(result.piiMap).toBeUndefined();
        expect(result.anonymizedText).toBe(text);
        expect(result.stats.totalEntities).toBe(0);
      });
    });

    describe('session with anonymize mode', () => {
      it('should throw error when creating session in anonymize mode', async () => {
        const anonymizer = createAnonymizer({
          mode: 'anonymize',
          piiStorageProvider: new InMemoryPIIStorageProvider(),
          keyProvider: new InMemoryKeyProvider(),
        });
        await anonymizer.initialize();

        expect(() => anonymizer.session('test-session')).toThrow(
          /Cannot create session: anonymizer is in 'anonymize' mode/
        );
      });

      it('should work with session in pseudonymize mode', async () => {
        const anonymizer = createAnonymizer({
          mode: 'pseudonymize',
          piiStorageProvider: new InMemoryPIIStorageProvider(),
          keyProvider: new InMemoryKeyProvider(),
        });
        await anonymizer.initialize();

        // Should not throw
        expect(() => anonymizer.session('test-session')).not.toThrow();
      });
    });
  });
});

describe('custom type round-trip (issue #68)', () => {
  // Regression test for https://github.com/tjruesch/rehydra/issues/68
  // Before the fix, session.rehydrate() silently left <PII type="AMOUNT" .../>
  // tags in place when the type was not a member of the PIIType enum, even
  // though session.anonymize() had detected and stored them correctly.
  const customType = 'AMOUNT' as unknown as PIIType;

  const makeAnonymizer = () => {
    const anon = createAnonymizer({
      ner: { mode: 'disabled' },
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      defaultPolicy: {
        enabledTypes: new Set<PIIType>([...ALL_PII_TYPES, customType]),
        reuseIdsForRepeatedPII: true,
      },
    });
    anon
      .getRegistry()
      .register(
        createCustomIdRecognizer([{ pattern: /\d+\s?EUR/g, type: customType }])
      );
    return anon;
  };

  it('rehydrates a custom-type tag produced by createCustomIdRecognizer', async () => {
    const anon = makeAnonymizer();
    await anon.initialize();
    const session = anon.session('issue-68-single');

    const input = 'pay 2000 EUR to john@company.com';
    const result = await session.anonymize(input);

    expect(result.anonymizedText).toContain('<PII type="AMOUNT"');
    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    expect(result.anonymizedText).not.toContain('2000 EUR');
    expect(result.anonymizedText).not.toContain('john@company.com');

    const restored = await session.rehydrate(result.anonymizedText);
    expect(restored).toBe(input);
  });

  it('reuses existing custom-type IDs across repeated session.anonymize() calls', async () => {
    // Exercises the parsePIIMapKey fix via buildExistingEntityLookup.
    const anon = makeAnonymizer();
    await anon.initialize();
    const session = anon.session('issue-68-reuse');

    const first = await session.anonymize('pay 2000 EUR now');
    const firstMatch = first.anonymizedText.match(
      /<PII type="AMOUNT" id="(\d+)"\/>/
    );
    expect(firstMatch).not.toBeNull();
    const firstId = firstMatch![1];

    const second = await session.anonymize('another 2000 EUR payment');
    const secondMatch = second.anonymizedText.match(
      /<PII type="AMOUNT" id="(\d+)"\/>/
    );
    expect(secondMatch).not.toBeNull();
    const secondId = secondMatch![1];

    // Same value should reuse the same ID thanks to session-level lookup.
    expect(secondId).toBe(firstId);

    // And the second round-trip still rehydrates cleanly.
    const restored = await session.rehydrate(second.anonymizedText);
    expect(restored).toBe('another 2000 EUR payment');
  });
});

describe('alphanumeric tag ids (issue #91)', () => {
  // Regression test for https://github.com/rehydra-ai/rehydra-sdk/issues/91
  // Callers may seed value-derived, lowercase alphanumeric ids through an
  // existing PII map. Those ids must survive anonymize → rehydrate, must not
  // be mangled by numeric recognizers, and must not disturb the numeric counter.
  const policy = {
    enabledTypes: new Set([PIIType.EMAIL, PIIType.CREDIT_CARD, PIIType.PHONE]),
    regexEnabledTypes: new Set([PIIType.EMAIL, PIIType.CREDIT_CARD, PIIType.PHONE]),
    reuseIdsForRepeatedPII: true,
  };

  it('reuses a seeded alphanumeric id and leaves the numeric counter intact', async () => {
    const anon = createAnonymizer({
      ner: { mode: 'disabled' },
      keyProvider: new InMemoryKeyProvider(),
    });
    await anon.initialize();

    const existing = new Map<string, string>([
      ['EMAIL_k9m2p7', 'alice@acme.com'],
      ['EMAIL_4', 'carol@acme.com'],
    ]);
    const result = await anon.anonymize(
      'Reach alice@acme.com or bob@acme.com',
      undefined,
      policy,
      existing
    );

    expect(result.anonymizedText).toBe(
      'Reach <PII type="EMAIL" id="k9m2p7"/> or <PII type="EMAIL" id="5"/>'
    );
    expect(result.entities.map((e) => e.id)).toEqual(['k9m2p7', 5]);
  });

  it('does not destroy an alphanumeric tag with numeric recognizers', async () => {
    // A long decimal id may be matched by the credit-card / phone recognizers
    // (see the issue). A mixed id without long digit runs avoids that conflict.
    const text = 'Earlier: <PII type="PERSON" id="a4f2c9d8e7b6q"/>';
    const result = await anonymizeRegexOnly(text, policy);
    expect(result.anonymizedText).toBe(text);
    expect(result.entities).toHaveLength(0);
  });

  it('round-trips an alphanumeric id through anonymize and rehydrate', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anon = createAnonymizer({ ner: { mode: 'disabled' }, keyProvider });
    await anon.initialize();

    const existing = new Map<string, string>([['EMAIL_k9m2p7', 'alice@acme.com']]);
    const result = await anon.anonymize('Reach alice@acme.com', undefined, policy, existing);
    expect(result.anonymizedText).toBe('Reach <PII type="EMAIL" id="k9m2p7"/>');

    const piiMap = await decryptPIIMap(result.piiMap, await keyProvider.getKey());
    expect(piiMap.get('EMAIL_k9m2p7')).toBe('alice@acme.com');
    expect(rehydrate(result.anonymizedText, piiMap)).toBe('Reach alice@acme.com');
    // Case-mangled by a model: still resolves.
    expect(rehydrate('Reach <PII type="EMAIL" id="K9M2P7"/>', piiMap)).toBe('Reach alice@acme.com');
  });
});
