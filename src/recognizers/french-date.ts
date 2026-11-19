/**
 * French written-date recognizer: "15 mars 2024", "1er janvier 2024",
 * "mars 2024", "3 févr. 2024" and, with a full month name, "15 mars".
 * Numeric dates are covered by the built-in date recognizer.
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import type { Recognizer } from './base.js';

/** Full month names, with unaccented spellings. */
const FULL_MONTHS: ReadonlyArray<[string, number]> = [
  ['janvier', 1],
  ['février', 2],
  ['fevrier', 2],
  ['mars', 3],
  ['avril', 4],
  ['mai', 5],
  ['juin', 6],
  ['juillet', 7],
  ['août', 8],
  ['aout', 8],
  ['septembre', 9],
  ['octobre', 10],
  ['novembre', 11],
  ['décembre', 12],
  ['decembre', 12],
];

/** Common abbreviations. They are only accepted with a year. */
const SHORT_MONTHS: ReadonlyArray<[string, number]> = [
  ['janv', 1],
  ['févr', 2],
  ['fevr', 2],
  ['fév', 2],
  ['fev', 2],
  ['avr', 4],
  ['juil', 7],
  ['sept', 9],
  ['oct', 10],
  ['nov', 11],
  ['déc', 12],
  ['dec', 12],
];

const MONTH_NUMBERS = new Map<string, number>([...FULL_MONTHS, ...SHORT_MONTHS]);

function alternation(months: ReadonlyArray<[string, number]>): string {
  return months
    .map(([name]) => name)
    .sort((a, b) => b.length - a.length)
    .join('|');
}

const FULL = alternation(FULL_MONTHS);
const SHORT = alternation(SHORT_MONTHS);
const SPACE = '[\\t \\u00A0]+';
const DAY = '(?<day>1er|1ᵉʳ|0?[1-9]|[12][0-9]|3[01])';
const YEAR = '(?<year>[0-9]{4})';
const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';

const PATTERNS = [
  // 15 mars 2024, 1er janvier 2024, 3 févr. 2024
  new RegExp(`${BEFORE}${DAY}${SPACE}(?<month>${FULL}|(?:${SHORT})\\.?)${SPACE}${YEAR}${AFTER}`, 'giu'),
  // 15 mars (full month names only: "3 sept" could be the number seven).
  // Not before a year, which the first pattern has already accepted or rejected.
  new RegExp(`${BEFORE}${DAY}${SPACE}(?<month>${FULL})${AFTER}(?!${SPACE}[0-9]{4}${AFTER})`, 'giu'),
  // mars 2024, oct. 2024. Not after a day number: if "32 mars 2024" fails
  // as a full date, its month and year shouldn't be masked on their own.
  new RegExp(
    `${BEFORE}(?<![\\p{N}](?:er|ᵉʳ)?${SPACE})(?<month>${FULL}|(?:${SHORT})\\.?)${SPACE}${YEAR}${AFTER}`,
    'giu',
  ),
];

function daysInMonth(month: number, year: number | undefined): number {
  // Without a year, allow 29 February.
  return new Date(year ?? 2000, month, 0).getDate();
}

function isValid(groups: Record<string, string | undefined>): boolean {
  const month = MONTH_NUMBERS.get((groups.month ?? '').toLowerCase().replace(/\.$/, ''));
  if (month === undefined) return false;

  const year = groups.year === undefined ? undefined : Number(groups.year);
  if (year !== undefined && (year < 1900 || year > 2099)) return false;

  if (groups.day === undefined) return true;
  const dayText = groups.day.toLowerCase();
  const day = dayText === '1er' || dayText === '1ᵉʳ' ? 1 : Number(dayText);
  return day >= 1 && day <= daysInMonth(month, year);
}

export const frenchDateRecognizer: Recognizer = {
  type: PIIType.DATE,
  name: 'FR Written Date',
  defaultConfidence: 0.9,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined || match.groups === undefined) continue;
        if (!isValid(match.groups)) continue;
        matches.push({
          type: PIIType.DATE,
          start: match.index,
          end: match.index + match[0].length,
          confidence: this.defaultConfidence,
          source: DetectionSource.REGEX,
          text: match[0],
        });
      }
    }
    return keepLongest(matches);
  },

  normalize(date: string): string {
    return date.trim();
  },
};

/** Drops matches contained in or overlapping a longer one ("mars 2024" inside "15 mars 2024"). */
function keepLongest(matches: SpanMatch[]): SpanMatch[] {
  const sorted = [...matches].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: SpanMatch[] = [];
  for (const match of sorted) {
    if (kept.every((other) => match.end <= other.start || match.start >= other.end)) {
      kept.push(match);
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}
