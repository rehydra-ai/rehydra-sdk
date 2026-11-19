/**
 * French identifier recognizers with checksum validation:
 * - NIR (numéro de sécurité sociale, carte Vitale): mod-97 key
 * - SIRET / SIREN (business registration numbers): Luhn
 */

import { PIIType } from '../types/index.js';
import { createRegexRecognizer } from './base.js';
import { validateLuhn } from '../utils/luhn.js';

/** Spaces used between digit groups, including French typographic spaces. */
const SPACE = '[ \\u00A0\\u202F]';
const NIR_SEPARATOR = '[ .\\u00A0\\u202F]?';

/**
 * NIR layout: sex (1), birth year (2), birth month (2), department (2, or
 * 2A/2B for Corsica) and commune (3), birth order (3), key (2). Overseas
 * departments use a 3-digit department and a 2-digit commune, which changes
 * where people put the space but not the digit count.
 */
const NIR_PATTERN = new RegExp(
  [
    '(?<![\\p{L}\\p{N}])',
    '[1-478]',
    `${NIR_SEPARATOR}\\d{2}`,
    `${NIR_SEPARATOR}(?:0[1-9]|1[0-2]|[2-9]\\d)`,
    `${NIR_SEPARATOR}(?:(?:\\d{2}|2[AB])${NIR_SEPARATOR}\\d{3}|\\d{3}${NIR_SEPARATOR}\\d{2})`,
    `${NIR_SEPARATOR}\\d{3}`,
    `${NIR_SEPARATOR}\\d{2}`,
    '(?![\\p{L}\\p{N}])',
  ].join(''),
  'giu',
);

/**
 * Checks a NIR's structure and mod-97 key. The key is 97 minus the first 13
 * digits modulo 97; Corsican departments 2A and 2B count as 19 and 18.
 */
export function isValidNIR(value: string): boolean {
  const compact = value.replace(/[ .\u00A0\u202F]/g, '').toUpperCase();
  if (!/^[1-478]\d{4}(?:\d{2}|2[AB])\d{8}$/.test(compact)) return false;

  const month = Number(compact.slice(3, 5));
  if (month === 0 || (month > 12 && month < 20)) return false;

  const department = compact.slice(5, 7);
  const departmentDigits = department === '2A' ? '19' : department === '2B' ? '18' : department;
  const body = Number(compact.slice(0, 5) + departmentDigits + compact.slice(7, 13));
  return Number(compact.slice(13)) === 97 - (body % 97);
}

export const frenchNirRecognizer = createRegexRecognizer({
  type: PIIType.NATIONAL_ID,
  name: 'FR NIR (sécurité sociale)',
  patterns: [NIR_PATTERN],
  defaultConfidence: 0.95,
  validate: isValidNIR,
  normalize: (value) => value.replace(/[ .\u00A0\u202F]/g, '').toUpperCase(),
});

/** La Poste establishments share a SIREN whose SIRETs fail Luhn by design. */
const LA_POSTE_SIREN = '356000000';

/**
 * Checks a SIREN (9 digits) or SIRET (14 digits) checksum. Both use Luhn,
 * except La Poste SIRETs, whose digits must sum to a multiple of 5.
 */
export function isValidSiretOrSiren(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 9) return validateLuhn(digits);
  if (digits.length !== 14) return false;
  if (digits.startsWith(LA_POSTE_SIREN)) {
    const sum = [...digits].reduce((total, digit) => total + Number(digit), 0);
    return sum % 5 === 0;
  }
  return validateLuhn(digits);
}

/**
 * A SIRET written in its usual 3-3-3-5 grouping. Luhn alone passes one random
 * number in ten, so bare 14- and 9-digit runs (timestamps, order numbers,
 * amounts with space thousands separators) are left alone unless labelled.
 */
const GROUPED_SIRET_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])\\d{3}${SPACE}\\d{3}${SPACE}\\d{3}${SPACE}(?:\\d{5}|\\d{3}${SPACE}\\d{2})(?![\\p{L}\\p{N}])`,
  'gu',
);

/** "SIRET", "SIREN", "SIRET n°", "Siren :" and similar labels. */
const LABEL = `\\b(?:SIRET|SIREN)(?:${SPACE}*(?:n[°º]|no\\.?|num[ée]ro))?${SPACE}*[:#]?${SPACE}*`;

/** A labelled SIRET (14 digits) or SIREN (9 digits), grouped or not. */
const LABELLED_PATTERN = new RegExp(
  `(?<=${LABEL})\\d{3}${SPACE}?\\d{3}${SPACE}?\\d{3}(?:${SPACE}?\\d{5}|${SPACE}\\d{3}${SPACE}\\d{2})?(?![\\p{L}\\p{N}])`,
  'giu',
);

export const frenchSiretRecognizer = createRegexRecognizer({
  type: PIIType.TAX_ID,
  name: 'FR SIRET/SIREN',
  patterns: [GROUPED_SIRET_PATTERN, LABELLED_PATTERN],
  defaultConfidence: 0.95,
  validate: isValidSiretOrSiren,
  normalize: (value) => value.replace(/\D/g, ''),
});
