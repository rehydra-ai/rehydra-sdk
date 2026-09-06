/**
 * UK Postal Code Recognizer
 * Detects syntactically valid UK unit postcodes.
 */

import { PIIType } from '../types/index.js';
import { createRegexRecognizer } from './base.js';

/**
 * UK postcode syntax, including the exceptional GIR 0AA postcode.
 *
 * The outward code uses the letter restrictions from UK government postcode
 * validation guidance. The inward code excludes C, I, K, M, O, and V.
 * Horizontal whitespace is optional so normalized forms such as N164HY are
 * detected without allowing a match to cross a line boundary.
 */
const UK_POSTAL_CODE_BODY =
  '(?:GIR[\\t ]*0AA|(?:[A-PR-UWYZ][0-9]{1,2}|[A-PR-UWYZ][A-HK-Y][0-9]{1,2}|[A-PR-UWYZ][0-9][A-HJKPSTUW]|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRVWXY])[\\t ]*[0-9][ABD-HJLNP-UW-Z]{2})';

export const UK_POSTAL_CODE_PATTERN = new RegExp(
  `(?<![A-Z0-9])${UK_POSTAL_CODE_BODY}(?![A-Z0-9])`,
  'gi',
);

const UK_POSTAL_CODE_VALIDATION_PATTERN = new RegExp(
  `^${UK_POSTAL_CODE_BODY}$`,
  'i',
);

/**
 * Checks UK postcode syntax. This does not verify that Royal Mail currently
 * assigns the postcode.
 */
export function isValidUKPostalCode(postalCode: string): boolean {
  return UK_POSTAL_CODE_VALIDATION_PATTERN.test(postalCode.trim());
}

/**
 * Converts a UK postcode to uppercase with one space before the inward code.
 */
export function normalizeUKPostalCode(postalCode: string): string {
  const compact = postalCode.trim().replace(/[\t ]+/g, '').toUpperCase();
  if (compact.length <= 3) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export const ukPostalCodeRecognizer = createRegexRecognizer({
  type: PIIType.POSTAL_CODE,
  name: 'UK Postal Code',
  patterns: [UK_POSTAL_CODE_PATTERN],
  defaultConfidence: 0.95,
  validate: isValidUKPostalCode,
  normalize: normalizeUKPostalCode,
});
