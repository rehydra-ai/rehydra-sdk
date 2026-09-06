/** Conservative detection of numbered, English-language street addresses. */
import { PIIType } from '../types/index.js';
import { createRegexRecognizer } from './base.js';
import { UK_POSTAL_CODE_PATTERN } from './postal-code.js';

const NUMBER = String.raw`[0-9]{1,5}[a-z]?(?:[-/][0-9]{1,5}[a-z]?)?`;
const WORD = String.raw`[\p{L}][\p{L}.'’\-]*`;
const STREET = String.raw`${NUMBER}[\t ]+(?:${WORD}[\t ]+){1,6}(?:Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Court|Ct|Crescent|Way|Place|Pl|Terrace|Gardens|Grove|Square|Sq|Mews|Row|Hill|Park|Walk|Rise|Green)\b`;
// An apartment number alone is ambiguous. Require an adjacent numbered street.
const UNIT = String.raw`(?:(?:Flat|Apartment|Apt|Unit|Suite)[\t ]+${NUMBER}[\t ]*(?:,[\t ]*|\r?\n[\t ]*|[\t ]+))?`;
// Include locality lines only when a UK postcode terminates the address block.
// Bounded line/word counts keep prose and separate paragraphs out of the match.
const LOCALITY = String.raw`(?:${WORD}[\t ]+){0,4}${WORD}`;
const SEPARATOR = String.raw`[\t ]*(?:,[\t ]*|\r?\n[\t ]*)`;
const POSTAL_TAIL = String.raw`(?:${SEPARATOR}(?:${LOCALITY}${SEPARATOR}){0,3}${UK_POSTAL_CODE_PATTERN.source})?`;

export const streetAddressRecognizer = createRegexRecognizer({
  type: PIIType.ADDRESS,
  name: 'Numbered Street Address',
  patterns: [new RegExp(String.raw`(?<![\p{L}\p{N}])${UNIT}${STREET}${POSTAL_TAIL}`, 'giu')],
  defaultConfidence: 0.95,
  // Travel directions describe distances rather than a street number.
  validate: (text) => !/^[0-9]+[\t ]+(?:steps?|miles?|metres?|meters?|kilometres?|kilometers?|blocks?)[\t ]/i.test(text),
});
