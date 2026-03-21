/**
 * BIC/SWIFT Code Recognizer
 * Bank Identifier Code (ISO 9362)
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import type { Recognizer } from './base.js';

/**
 * BIC/SWIFT code pattern
 * Format: AAAA BB CC DDD (8 or 11 characters)
 * - AAAA: Bank code (4 letters)
 * - BB: Country code (2 letters, ISO 3166-1)
 * - CC: Location code (2 alphanumeric)
 * - DDD: Branch code (3 alphanumeric, optional)
 */
const BIC_PATTERN = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;

/**
 * Valid ISO 3166-1 alpha-2 country codes (common subset)
 */
const VALID_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU', 'AW', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BM', 'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ',
  'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IN', 'IQ', 'IR', 'IS', 'IT',
  'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
]);

/**
 * BIC/SWIFT code recognizer
 */
export const bicSwiftRecognizer: Recognizer = {
  type: PIIType.BIC_SWIFT,
  name: 'BIC/SWIFT Code',
  defaultConfidence: 0.95,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    const pattern = new RegExp(BIC_PATTERN.source, 'g');

    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;

      const bic = match[0];

      // Validate the BIC code
      if (!this.validate!(bic)) continue;

      matches.push({
        type: PIIType.BIC_SWIFT,
        start: match.index,
        end: match.index + bic.length,
        confidence: this.defaultConfidence,
        source: DetectionSource.REGEX,
        text: bic,
      });
    }

    return matches;
  },

  validate(bic: string): boolean {
    const normalized = bic.toUpperCase();

    // Check length (8 or 11 characters)
    if (normalized.length !== 8 && normalized.length !== 11) {
      return false;
    }

    // Extract and validate country code (characters 5-6)
    const countryCode = normalized.slice(4, 6);
    if (!VALID_COUNTRY_CODES.has(countryCode)) {
      return false;
    }

    // Bank code should be letters only
    const bankCode = normalized.slice(0, 4);
    if (!/^[A-Z]{4}$/.test(bankCode)) {
      return false;
    }

    // Reject common English words that happen to match BIC format
    const COMMON_WORDS = new Set([
      'HEALTHCHECK', 'COMPLAIN', 'COMPLAINT',
      'DISCOVER', 'DISPATCH', 'DISPLAYS',
      'DOWNLOAD', 'DOCUMENT',
      'EXCHANGE', 'EXPLICIT',
      'FUNCTION',
      'GENERATE',
      'IMPLICIT', 'INDUSTRY',
      'LOCATION',
      'MERCHANT', 'MINISTER',
      'NATIONAL',
      'OPERATOR', 'OPTIONAL', 'OPPOSITE',
      'PLATFORM', 'PRACTICE', 'PRODUCED', 'PROTOCOL', 'PROVIDER', 'PUBLICLY',
      'QUESTION',
      'REGISTER', 'RELATION', 'REQUIRED', 'RESEARCH', 'RESOURCE',
      'SECURITY', 'SERVICES', 'SOFTWARE', 'SPECIFIC', 'STANDARD', 'SUBJECTS',
      'TEMPLATE', 'TRANSFER', 'TRUNCATE',
    ]);
    if (COMMON_WORDS.has(normalized)) {
      return false;
    }

    // Location code should be alphanumeric
    const locationCode = normalized.slice(6, 8);
    if (!/^[A-Z0-9]{2}$/.test(locationCode)) {
      return false;
    }

    // Branch code (if present) should be alphanumeric
    if (normalized.length === 11) {
      const branchCode = normalized.slice(8, 11);
      if (!/^[A-Z0-9]{3}$/.test(branchCode)) {
        return false;
      }
    }

    return true;
  },

  normalize(bic: string): string {
    return bic.toUpperCase().trim();
  },
};

