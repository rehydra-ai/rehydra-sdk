import { describe, expect, it } from 'vitest';
import {
  frenchNirRecognizer,
  frenchSiretRecognizer,
  isValidNIR,
  isValidSiretOrSiren,
} from '../../src/recognizers/french-ids.js';
import { createAnonymizer } from '../../src/index.js';
import { DetectionSource, PIIType } from '../../src/types/index.js';

describe('French NIR Recognizer', () => {
  it.each([
    ['contiguous', '185057800608491'],
    ['grouped with spaces', '1 85 05 78 006 084 91'],
    ['grouped with dots', '1.85.05.78.006.084.91'],
    ['overseas department grouping', '2 90 01 971 12 345 46'],
    ['Corsica 2A', '1 75 04 2A 012 003 22'],
    ['Corsica 2B', '268092B04501797'],
  ])('should detect a valid NIR (%s)', (_label, nir) => {
    const matches = frenchNirRecognizer.find(`N° de sécurité sociale : ${nir}.`);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      type: PIIType.NATIONAL_ID,
      text: nir,
      source: DetectionSource.REGEX,
    });
  });

  it.each([
    ['wrong key', '185057800608492'],
    ['sex digit 5', '585057800608491'],
    ['month 13', '185137800608491'],
    ['month 00', '185007800608491'],
  ])('should reject an invalid NIR (%s)', (_label, nir) => {
    expect(frenchNirRecognizer.find(`NIR ${nir}`)).toHaveLength(0);
  });

  it('should not match inside a longer digit run', () => {
    expect(frenchNirRecognizer.find('id 9185057800608491')).toHaveLength(0);
    expect(frenchNirRecognizer.find('id 1850578006084910')).toHaveLength(0);
  });

  it('should validate Corsican keys with the 19/18 substitution', () => {
    expect(isValidNIR('175042A01200322')).toBe(true);
    expect(isValidNIR('175042B01200322')).toBe(false);
  });

  it('should normalize to compact uppercase', () => {
    expect(frenchNirRecognizer.normalize?.('1 75 04 2a 012 003 22')).toBe('175042A01200322');
  });
});

describe('French SIRET/SIREN Recognizer', () => {
  it.each([
    ['grouped SIRET', 'Établissement 732 829 320 00074 à Paris', '732 829 320 00074'],
    ['grouped SIRET, 3-3-3-3-2', 'Établissement 732 829 320 000 74', '732 829 320 000 74'],
    ['grouped SIRET, non-breaking spaces', 'n° 732\u00A0829\u00A0320\u00A000074', '732\u00A0829\u00A0320\u00A000074'],
    ['labelled contiguous SIRET', 'SIRET : 73282932000074', '73282932000074'],
    ['labelled SIRET with n°', 'Siret n° 73282932000074', '73282932000074'],
    ['labelled SIREN', 'SIREN 732 829 320', '732 829 320'],
    ['labelled contiguous SIREN', 'numéro SIREN: 732829320.', '732829320'],
    ['La Poste SIRET', 'SIRET 35600000049837', '35600000049837'],
  ])('should detect a %s', (_label, text, expected) => {
    const matches = frenchSiretRecognizer.find(text);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PIIType.TAX_ID, text: expected });
  });

  it.each([
    ['unlabelled contiguous SIRET', 'Migration 73282932000074_create_users'],
    ['unlabelled grouped SIREN', 'Le montant est de 732 829 320 euros'],
    ['labelled SIREN with a bad checksum', 'SIREN 732829321'],
    ['labelled SIRET with a bad checksum', 'SIRET 73282932000075'],
    ['labelled 10-digit number', 'SIREN 7328293201'],
    ['La Poste SIRET failing its digit-sum rule', 'SIRET 35600000049838'],
  ])('should ignore an %s', (_label, text) => {
    expect(frenchSiretRecognizer.find(text)).toHaveLength(0);
  });

  it('should match a labelled grouped SIRET once', () => {
    expect(frenchSiretRecognizer.find('SIRET 732 829 320 00074')).toHaveLength(1);
  });

  it('should validate by length', () => {
    expect(isValidSiretOrSiren('732829320')).toBe(true);
    expect(isValidSiretOrSiren('73282932000074')).toBe(true);
    expect(isValidSiretOrSiren('7328293200007')).toBe(false);
  });
});

describe('French IDs in the default anonymizer', () => {
  it('should redact NIR and SIRET with the default policy', async () => {
    const anonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize(
      'Assuré 1 85 05 78 006 084 91, employeur SIRET 732 829 320 00074.',
    );

    expect(result.anonymizedText).not.toContain('006 084 91');
    expect(result.anonymizedText).not.toContain('00074');
    expect(result.stats.countsByType[PIIType.NATIONAL_ID]).toBe(1);
    expect(result.stats.countsByType[PIIType.TAX_ID]).toBe(1);
    await anonymizer.dispose();
  });

  it('should leave ordinary French prose alone', async () => {
    const anonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await anonymizer.initialize();
    const prose =
      "La réunion du conseil s'est tenue à Marseille. Le budget de 732 829 320 euros a été voté à l'unanimité.";

    const result = await anonymizer.anonymize(prose);

    expect(result.anonymizedText).toBe(prose);
    await anonymizer.dispose();
  });
});
