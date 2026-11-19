/**
 * French postal code and street address recognizers.
 *
 * The patterns avoid the `i` flag: with it, `\p{Lu}` also matches lowercase
 * letters, and a capitalized street or city name is what tells an address
 * apart from prose such as "3 cours de math". Keywords are spelled out in
 * lowercase, Capitalized and UPPERCASE instead.
 */

import { PIIType } from '../types/index.js';
import { createRegexRecognizer } from './base.js';
import { escapeRegExp } from '../utils/regex.js';

function anyCase(words: readonly string[]): string {
  const forms = new Set<string>();
  for (const word of words) {
    forms.add(word);
    forms.add(word.charAt(0).toUpperCase() + word.slice(1));
    forms.add(word.toUpperCase());
  }
  // Longest first, so "avenue" wins over "av." and "allée" over "all".
  return [...forms]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

/** Metropolitan departments 01-95, overseas 97x and 98x. */
const POSTCODE = String.raw`(?:0[1-9]|[1-8][0-9]|9[0-8])[0-9]{3}`;
const CAPITALIZED_WORD = String.raw`\p{Lu}[\p{L}'’\-]*`;
const ELIDED = String.raw`[dlDL]['’]`;

/** "Saint-Germain-en-Laye", "Le Havre", "Villeneuve d'Ascq", "Sully sur Loire". */
const CITY_PARTICLE = String.raw`(?:sur|sous|en|lès|lez|le|la|les|de|du|des|aux|au|et)`;
const CITY = String.raw`${CAPITALIZED_WORD}(?:[\t ]+(?:${CITY_PARTICLE}[\t ]+)*(?:${ELIDED})?${CAPITALIZED_WORD}){0,4}`;
const CEDEX = String.raw`(?:[\t ]+(?:CEDEX|Cedex)(?:[\t ]+[0-9]{1,2})?)?`;

/**
 * A postcode at the start of a line or after a comma, semicolon or colon,
 * followed by a city name that ends the line or clause. Only the postcode is
 * masked, as with UK postcodes; the city on its own is a coarse location.
 */
const POSTAL_CODE_PATTERN = new RegExp(
  String.raw`(?<=^[\t ]*|[,;:][\t ]*)${POSTCODE}(?=[\t ]+${CITY}${CEDEX}[\t ]*(?:$|[,.;)]))`,
  'gmu',
);

export const frenchPostalCodeRecognizer = createRegexRecognizer({
  type: PIIType.POSTAL_CODE,
  name: 'FR Postal Code',
  patterns: [POSTAL_CODE_PATTERN],
  defaultConfidence: 0.9,
});

const NUMBER = String.raw`[0-9]{1,4}(?:[\t ]?(?:bis|ter|quater|BIS|TER|[A-D]))?(?:[-/][0-9]{1,4})?`;
const STREET_TYPES = anyCase([
  'rue',
  'avenue',
  'av.',
  'boulevard',
  'bd',
  'place',
  'pl.',
  'impasse',
  'chemin',
  'allée',
  'allee',
  'quai',
  'route',
  'passage',
  'square',
  'faubourg',
  'voie',
  'esplanade',
  'promenade',
  'sentier',
  'rond-point',
  'parvis',
  'montée',
  'traverse',
]);
/** "Cours" also means a class ("3 cours de Python"), so it needs a postcode. */
const COURS = anyCase(['cours']);
const NAME_PARTICLE = anyCase(['de', 'du', 'des', 'la', 'le', 'les', 'à', 'au', 'aux', 'sur', 'sous', 'en', 'et']);
const PARTICLES = String.raw`(?:(?:${NAME_PARTICLE})[\t ]+|${ELIDED})*`;
/** The name starts with a capital, or a day number before one ("rue du 8 Mai 1945"). */
const NAME = String.raw`${PARTICLES}(?:[0-9]{1,2}[\t ]+)?${CAPITALIZED_WORD}(?:[\t ]+${PARTICLES}(?:${CAPITALIZED_WORD}|[0-9]{1,4}(?![\p{N}]))){0,5}`;
const SEPARATOR = String.raw`(?:[\t ]*,[\t ]*|[\t ]*\r?\n[\t ]*|[\t ]+)`;
const POSTAL_TAIL = String.raw`${SEPARATOR}${POSTCODE}[\t ]+${CITY}${CEDEX}`;
const START = String.raw`(?<![\p{L}\p{N}])${NUMBER},?[\t ]+`;

export const frenchStreetAddressRecognizer = createRegexRecognizer({
  type: PIIType.ADDRESS,
  name: 'FR Street Address',
  patterns: [
    new RegExp(String.raw`${START}(?:${STREET_TYPES})(?![\p{L}])[\t ]+${NAME}(?:${POSTAL_TAIL})?`, 'gu'),
    new RegExp(String.raw`${START}(?:${COURS})(?![\p{L}])[\t ]+${NAME}${POSTAL_TAIL}`, 'gu'),
  ],
  defaultConfidence: 0.9,
});
