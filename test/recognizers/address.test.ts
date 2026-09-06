import { describe, expect, it } from 'vitest';
import { streetAddressRecognizer } from '../../src/recognizers/address.js';
import { createAnonymizer, InMemoryKeyProvider, InMemoryPIIStorageProvider, PIIType } from '../../src/index.js';

describe('numbered street addresses', () => {
  it.each([
    '34a Ishwin Road', '3a Ishwin Road', 'Flat 1\n34a Friskin Road',
    'Flat 1, 34a Friskin Road', 'Apartment 12 14 High Street',
    'Flat 1\r\n34a Friskin Road\r\nLondon\r\nN16 4HY',
    '34a Friskin Road, London, N16 4HY', '10 Downing Street\nLondon\nSW1A 2AA',
  ])('covers the complete address %s', (address) => {
    const text = `Send to ${address}. Thank you.`;
    expect(streetAddressRecognizer.find(text).map(m => m.text)).toEqual([address]);
  });

  it.each(['Flat 1', 'Unit 42', 'Take 2 steps down the road', '42 errors in test suite', 'A walk in the Park', 'High Street', 'ref34a Ishwin Road'])('leaves ambiguous text unchanged: %s', (text) => {
    expect(streetAddressRecognizer.find(text)).toEqual([]);
  });

  it('does not absorb paragraphs between a street and a postcode', () => {
    const text = '34a Friskin Road\n\nPlease send a letter.\nN16 4HY';
    expect(streetAddressRecognizer.find(text).map(m => m.text)).toEqual(['34a Friskin Road']);
  });

  it('preserves offsets and repeated address identity through a session', async () => {
    const anon = createAnonymizer({ keyProvider: new InMemoryKeyProvider(), piiStorageProvider: new InMemoryPIIStorageProvider(), defaultPolicy: { reuseIdsForRepeatedPII: true } });
    try {
      await anon.initialize();
      const session = anon.session('address');
      const address = 'Flat 1\n34a Friskin Road\nLondon\nN16 4HY';
      const text = `${address}\nOr postcode n16 4hy. Again: ${address}`;
      const result = await session.anonymize(text);
      expect(result.anonymizedText).not.toContain('Flat 1');
      expect(result.anonymizedText).not.toContain('34a');
      expect(result.anonymizedText).not.toContain('London');
      expect(result.anonymizedText).not.toContain('4HY');
      expect(result.stats.countsByType[PIIType.ADDRESS]).toBe(2);
      expect(result.stats.countsByType[PIIType.POSTAL_CODE]).toBe(1);
      expect(await session.rehydrate(result.anonymizedText)).toBe(text);
      expect((await session.anonymize(address)).anonymizedText).toBe(result.anonymizedText.split('\n')[0]);
    } finally { await anon.dispose(); }
  });

  it('respects disabling both detection types', async () => {
    const anon = createAnonymizer();
    try {
      await anon.initialize();
      const text = 'Flat 1\n34a Friskin Road\nLondon\nN16 4HY';
      const result = await anon.anonymize(text, undefined, { regexEnabledTypes: new Set([PIIType.EMAIL]) });
      expect(result.anonymizedText).toBe(text);
      expect(result.stats.totalEntities).toBe(0);
    } finally { await anon.dispose(); }
  });
});
