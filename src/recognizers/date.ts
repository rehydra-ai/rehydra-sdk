/**
 * Date Recognizer
 * Detects common date formats: ISO, US, EU, and written (English) dates
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import type { Recognizer } from './base.js';

const MONTHS_LONG = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTHS_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

const MONTH_NAME_PATTERN = `(?:${MONTHS_LONG.join('|')}|${MONTHS_SHORT.join('|')})`;

/**
 * Date patterns organized by format family
 *
 * Numeric patterns use negative lookbehind/lookahead for digits and dots
 * to avoid matching inside IP addresses, version numbers, or longer numeric strings.
 */
const DATE_PATTERNS = {
  // ISO: 2024-03-15, 2024/03/15
  iso: /(?<![0-9.])\b(\d{4})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])\b(?!\d)/gi,

  // EU dot: 15.03.2024
  euDot: /(?<![0-9.])\b(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(\d{4})\b(?![0-9.])/g,

  // US slash/dash: 03/15/2024, 03-15-2024
  usLong: /(?<![0-9.])\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](\d{4})\b(?!\d)/g,

  // EU slash/dash (day first): 15/03/2024, 15-03-2024
  // Only matches when day > 12 to disambiguate from US format
  euSlash: /(?<![0-9.])\b(1[3-9]|2\d|3[01])[/-](0?[1-9]|1[0-2])[/-](\d{4})\b(?!\d)/g,

  // Written long: March 15, 2024 / March 15 2024
  writtenMDY: new RegExp(
    `\\b${MONTH_NAME_PATTERN}\\.?\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'gi',
  ),

  // Written day-first: 15 March 2024 / 15th March, 2024
  writtenDMY: new RegExp(
    `\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+${MONTH_NAME_PATTERN}\\.?,?\\s+(\\d{4})\\b`,
    'gi',
  ),
};

/**
 * Maps month name to number (1-12)
 */
function monthNameToNumber(name: string): number {
  const lower = name.toLowerCase().replace(/\.$/, '');
  const longIdx = MONTHS_LONG.indexOf(lower);
  if (longIdx !== -1) return longIdx + 1;
  const shortIdx = MONTHS_SHORT.indexOf(lower);
  if (shortIdx !== -1) return shortIdx + 1;
  return 0;
}

/**
 * Validates that month/day/year form a plausible calendar date
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Month length check (accounts for leap years)
  const maxDay = new Date(year, month, 0).getDate();
  return day <= maxDay;
}

/**
 * Parses and validates a numeric date match.
 * Returns true if the captured groups form a valid date.
 *
 * @param groups - three captured strings in the order they appear in the regex
 * @param order  - describes which group is year/month/day
 */
function validateNumericGroups(
  groups: [string, string, string],
  order: 'YMD' | 'DMY' | 'MDY',
): boolean {
  const nums = groups.map(Number) as [number, number, number];
  let year: number, month: number, day: number;

  switch (order) {
    case 'YMD':
      [year, month, day] = nums;
      break;
    case 'DMY':
      [day, month, year] = nums;
      break;
    case 'MDY':
      [month, day, year] = nums;
      break;
  }

  return isValidDate(year, month, day);
}

/**
 * Date recognizer with multi-format support
 */
export const dateRecognizer: Recognizer = {
  type: PIIType.DATE,
  name: 'Date',
  defaultConfidence: 0.9,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    const seen = new Set<string>();

    // --- Numeric patterns with explicit group ordering --------------------
    const numericEntries: { pattern: RegExp; order: 'YMD' | 'DMY' | 'MDY' }[] = [
      { pattern: DATE_PATTERNS.iso, order: 'YMD' },
      { pattern: DATE_PATTERNS.euDot, order: 'DMY' },
      { pattern: DATE_PATTERNS.usLong, order: 'MDY' },
      { pattern: DATE_PATTERNS.euSlash, order: 'DMY' },
    ];

    for (const { pattern, order } of numericEntries) {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

      for (const m of text.matchAll(re)) {
        if (m.index === undefined) continue;

        const matchText = m[0];
        const key = `${m.index}:${m.index + matchText.length}`;
        if (seen.has(key)) continue;

        const g1 = m[1];
        const g2 = m[2];
        const g3 = m[3];
        if (g1 === undefined || g2 === undefined || g3 === undefined) continue;

        if (!validateNumericGroups([g1, g2, g3], order)) continue;

        seen.add(key);
        matches.push({
          type: PIIType.DATE,
          start: m.index,
          end: m.index + matchText.length,
          confidence: this.defaultConfidence,
          source: DetectionSource.REGEX,
          text: matchText,
        });
      }
    }

    // --- Written patterns -------------------------------------------------
    const writtenPatterns = [DATE_PATTERNS.writtenMDY, DATE_PATTERNS.writtenDMY];

    for (const pattern of writtenPatterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

      for (const m of text.matchAll(re)) {
        if (m.index === undefined) continue;

        const matchText = m[0];
        const key = `${m.index}:${m.index + matchText.length}`;
        if (seen.has(key)) continue;

        // Extract month name from the full match
        const monthMatch = matchText.match(new RegExp(MONTH_NAME_PATTERN, 'i'));
        if (!monthMatch) continue;

        const monthNum = monthNameToNumber(monthMatch[0]);
        if (monthNum === 0) continue;

        // Extract day and year digits from captured groups
        const digits = [...matchText.matchAll(/\d+/g)].map((d) => Number(d[0]));
        if (digits.length < 2) continue;

        let day: number, year: number;
        if (digits[0]! <= 31 && digits[1]! >= 1900) {
          // day ... year
          day = digits[0]!;
          year = digits[1]!;
        } else if (digits[0]! >= 1900) {
          // year ... day  (unlikely in written form, but handle)
          year = digits[0]!;
          day = digits[1]!;
        } else {
          day = digits[0]!;
          year = digits[1]!;
        }

        if (!isValidDate(year, monthNum, day)) continue;

        seen.add(key);
        matches.push({
          type: PIIType.DATE,
          start: m.index,
          end: m.index + matchText.length,
          confidence: this.defaultConfidence,
          source: DetectionSource.REGEX,
          text: matchText,
        });
      }
    }

    return deduplicateOverlapping(matches);
  },

  normalize(date: string): string {
    return date.trim();
  },
};

/**
 * Remove overlapping matches, keeping longer ones
 */
function deduplicateOverlapping(matches: SpanMatch[]): SpanMatch[] {
  if (matches.length <= 1) return matches;

  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const result: SpanMatch[] = [];

  for (const match of sorted) {
    const last = result[result.length - 1];

    if (last !== undefined && match.start < last.end) {
      if (match.end - match.start > last.end - last.start) {
        result.pop();
        result.push(match);
      }
    } else {
      result.push(match);
    }
  }

  return result;
}
