import { describe, expect, it } from 'vitest';
import {
  frenchPostalCodeRecognizer,
  frenchStreetAddressRecognizer,
} from '../../src/recognizers/french-address.js';
import { frenchDateRecognizer } from '../../src/recognizers/french-date.js';
import { createAnonymizer } from '../../src/index.js';
import { PIIType } from '../../src/types/index.js';

function texts(matches: { text: string }[]): string[] {
  return matches.map((match) => match.text);
}

describe('French Postal Code Recognizer', () => {
  it.each([
    ['line start', '75008 Paris', '75008'],
    ['after a comma', 'Envoyer à Jean Dupont, 69003 Lyon.', '69003'],
    ['after a colon', 'Adresse : 13001 Marseille', '13001'],
    ['uppercase city', '33000 BORDEAUX', '33000'],
    ['hyphenated city', '78100 Saint-Germain-en-Laye', '78100'],
    ['multi-word city', '76600 Le Havre', '76600'],
    ['elided particle', '59650 Villeneuve d\'Ascq', '59650'],
    ['CEDEX', '92130 Issy-les-Moulineaux CEDEX 9', '92130'],
    ['Corsica', '20000 Ajaccio', '20000'],
    ['overseas', '97400 Saint-Denis', '97400'],
  ])('should detect a postcode (%s)', (_label, text, expected) => {
    expect(texts(frenchPostalCodeRecognizer.find(text))).toEqual([expected]);
  });

  it.each([
    ['a count in prose', 'Nous avons 12345 Utilisateurs actifs'],
    ['a city followed by more prose', '75008 Paris est une belle ville'],
    ['a lowercase word', '75008 paris'],
    ['department 00', '00123 Paris'],
    ['department 99', '99123 Paris'],
    ['a six-digit number', '750080 Paris'],
  ])('should ignore %s', (_label, text) => {
    expect(frenchPostalCodeRecognizer.find(text)).toHaveLength(0);
  });
});

describe('French Street Address Recognizer', () => {
  it.each([
    ['rue', 'Rendez-vous au 12 rue de la Paix demain.', '12 rue de la Paix'],
    ['bis and comma', 'Siège : 3 bis, avenue des Champs-Élysées', '3 bis, avenue des Champs-Élysées'],
    ['boulevard', 'au 45 boulevard Haussmann', '45 boulevard Haussmann'],
    ['place', 'au 7 place Bellecour', '7 place Bellecour'],
    ['elided name', '8 rue de l\'Église', '8 rue de l\'Église'],
    ['day-number street name', '10 rue du 8 Mai 1945', '10 rue du 8 Mai 1945'],
    ['uppercase', '12 RUE DE LA PAIX', '12 RUE DE LA PAIX'],
    ['abbreviated type', '5 bd Victor Hugo', '5 bd Victor Hugo'],
    ['with postcode on the same line', '12 rue de la Paix, 75002 Paris', '12 rue de la Paix, 75002 Paris'],
    ['with postcode on the next line', '12 rue de la Paix\n75002 Paris', '12 rue de la Paix\n75002 Paris'],
    ['cours with a postcode', '38 cours Mirabeau, 13100 Aix-en-Provence', '38 cours Mirabeau, 13100 Aix-en-Provence'],
  ])('should detect an address (%s)', (_label, text, expected) => {
    expect(texts(frenchStreetAddressRecognizer.find(text))).toEqual([expected]);
  });

  it.each([
    ['a lowercase street name', 'au 12 rue de la paix'],
    ['plural nouns', 'il reste 3 places et 2 rues'],
    ['cours meaning a class', "J'ai 3 cours de Python demain"],
    ['a number without a street type', 'Il y a 12 Personnes'],
  ])('should ignore %s', (_label, text) => {
    expect(frenchStreetAddressRecognizer.find(text)).toHaveLength(0);
  });
});

describe('French Written Date Recognizer', () => {
  it.each([
    ['day month year', 'Né le 15 mars 2024 à Lyon', '15 mars 2024'],
    ['1er', 'le 1er janvier 2024', '1er janvier 2024'],
    ['month year', 'en mars 2024', 'mars 2024'],
    ['day month', 'né le 15 mars', '15 mars'],
    ['abbreviated month with year', 'le 3 févr. 2024', '3 févr. 2024'],
    ['accented month', 'le 15 août 2023', '15 août 2023'],
    ['unaccented month', 'le 15 aout 2023', '15 aout 2023'],
    ['capitalized month', 'Mars 2024', 'Mars 2024'],
    ['29 February without a year', 'le 29 février', '29 février'],
  ])('should detect a date (%s)', (_label, text, expected) => {
    expect(texts(frenchDateRecognizer.find(text))).toEqual([expected]);
  });

  it.each([
    ['Marseille', 'Je vis à Marseille.'],
    ['a bare month', 'Le mois de mars est doux.'],
    ['an impossible day', 'le 32 mars 2024'],
    ['an impossible day without a year', 'le 32 mars'],
    ['31 April', 'le 31 avril 2024'],
    ['29 February in a common year', 'le 29 février 2023'],
    ['an abbreviation without a year', 'le 3 sept au soir'],
    ['a year out of range', 'en mars 3024'],
    ['a month inside a word', 'les marsouins de 2024'],
  ])('should ignore %s', (_label, text) => {
    expect(frenchDateRecognizer.find(text)).toHaveLength(0);
  });
});

describe('French address and dates in the default anonymizer', () => {
  it('should mask a full address block as one ADDRESS', async () => {
    const anonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Jean Dupont\n12 rue de la Paix\n75002 Paris');

    expect(result.stats.countsByType[PIIType.ADDRESS]).toBe(1);
    expect(result.stats.countsByType[PIIType.POSTAL_CODE]).toBe(0);
    expect(result.anonymizedText).not.toContain('75002');
    await anonymizer.dispose();
  });

  it('should mask a date written in French and in English once each', async () => {
    const anonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Rendez-vous le 15 oct. 2024 (October 15, 2024).');

    expect(result.stats.countsByType[PIIType.DATE]).toBe(2);
    await anonymizer.dispose();
  });

  it('should leave ordinary French prose alone', async () => {
    const anonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await anonymizer.initialize();
    const prose =
      "La réunion s'est tenue à Marseille en présence de 12 délégués. Le mois de mars a été chargé, avec 3 cours de Python et 2 places libres.";

    const result = await anonymizer.anonymize(prose);

    expect(result.anonymizedText).toBe(prose);
    await anonymizer.dispose();
  });
});
