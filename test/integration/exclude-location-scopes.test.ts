import { describe, it, expect, beforeAll } from 'vitest';
import {
  createAnonymizer,
  PIIType,
  createDefaultPolicy,
  mergePolicy,
  InMemoryKeyProvider,
} from '../../src/index.js';
import type { LocationScope } from '../../src/types/index.js';
import { isModelDownloaded } from '../../src/ner/model-manager.js';
import { isSemanticDataDownloaded } from '../../src/pipeline/semantic-data-loader.js';

describe('excludeLocationScopes', () => {
  describe('policy', () => {
    it('should default to an empty set', () => {
      const policy = createDefaultPolicy();
      expect(policy.excludeLocationScopes).toBeInstanceOf(Set);
      expect(policy.excludeLocationScopes.size).toBe(0);
    });

    it('should accept location scopes in partial policy', () => {
      const policy = mergePolicy({
        excludeLocationScopes: new Set<LocationScope>(['country', 'region']),
      });
      expect(policy.excludeLocationScopes.has('country')).toBe(true);
      expect(policy.excludeLocationScopes.has('region')).toBe(true);
      expect(policy.excludeLocationScopes.has('city')).toBe(false);
    });

    it('should preserve other policy fields when merging', () => {
      const policy = mergePolicy({
        excludeLocationScopes: new Set<LocationScope>(['country']),
      });
      // Other fields should still have defaults
      expect(policy.enabledTypes.has(PIIType.EMAIL)).toBe(true);
      expect(policy.enableLeakScan).toBe(true);
    });
  });

  describe('without semantic masking', () => {
    it('should ignore excludeLocationScopes when semantic masking is off', async () => {
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({ keyProvider });
      await anonymizer.initialize();

      const text = 'Contact support@example.com for info.';

      // Should not throw or change behavior
      const result = await anonymizer.anonymize(text, undefined, {
        excludeLocationScopes: new Set<LocationScope>(['country']),
      });

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('with NER and semantic masking', () => {
    let modelAvailable = false;
    let semanticAvailable = false;

    beforeAll(async () => {
      modelAvailable = await isModelDownloaded('quantized');
      semanticAvailable = await isSemanticDataDownloaded();
    });

    it(
      'should exclude countries and regions when configured',
      { timeout: 60_000 },
      async () => {
        if (!modelAvailable || !semanticAvailable) return;

        const keyProvider = new InMemoryKeyProvider();
        const anonymizer = createAnonymizer({
          keyProvider,
          ner: { mode: 'quantized', autoDownload: false },
          semantic: { enabled: true },
        });
        await anonymizer.initialize();

        const text =
          'Hello, my name is John Smith and I work at Apple Inc in Berlin, Germany.';

        // Without exclusions: both locations should be anonymized
        const resultAll = await anonymizer.anonymize(text);
        const locationEntities = resultAll.entities.filter(
          (e) => e.type === PIIType.LOCATION
        );

        // With exclusions: countries should be dropped
        const resultFiltered = await anonymizer.anonymize(text, undefined, {
          excludeLocationScopes: new Set<LocationScope>(['country', 'region']),
        });
        const filteredLocationEntities = resultFiltered.entities.filter(
          (e) => e.type === PIIType.LOCATION
        );

        // The filtered result should have fewer location entities
        expect(filteredLocationEntities.length).toBeLessThan(
          locationEntities.length
        );

        // "Germany" should still appear in the filtered output (not anonymized)
        expect(resultFiltered.anonymizedText).toContain('Germany');

        await anonymizer.dispose();
      }
    );

    it(
      'should exclude regions',
      { timeout: 60_000 },
      async () => {
        if (!modelAvailable || !semanticAvailable) return;

        const keyProvider = new InMemoryKeyProvider();
        const anonymizer = createAnonymizer({
          keyProvider,
          ner: { mode: 'quantized', autoDownload: false },
          semantic: { enabled: true },
        });
        await anonymizer.initialize();

        // "Bavaria" is classified as region by the semantic enricher
        const text =
          'John Smith traveled through Bavaria last summer.';

        const result = await anonymizer.anonymize(text, undefined, {
          excludeLocationScopes: new Set<LocationScope>(['region']),
        });

        // "Bavaria" classified as region should not be anonymized
        expect(result.anonymizedText).toContain('Bavaria');

        await anonymizer.dispose();
      }
    );

    it(
      'should keep all locations when excludeLocationScopes is empty',
      { timeout: 60_000 },
      async () => {
        if (!modelAvailable || !semanticAvailable) return;

        const keyProvider = new InMemoryKeyProvider();
        const anonymizer = createAnonymizer({
          keyProvider,
          ner: { mode: 'quantized', autoDownload: false },
          semantic: { enabled: true },
        });
        await anonymizer.initialize();

        const text =
          'Hello, my name is John Smith and I work at Apple Inc in Berlin, Germany.';

        const result = await anonymizer.anonymize(text, undefined, {
          excludeLocationScopes: new Set<LocationScope>(),
        });

        // Both locations should be anonymized
        const locationEntities = result.entities.filter(
          (e) => e.type === PIIType.LOCATION
        );
        expect(locationEntities.length).toBeGreaterThanOrEqual(2);

        await anonymizer.dispose();
      }
    );
  });
});
