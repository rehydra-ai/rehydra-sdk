/**
 * Phone Number Recognizer
 * Country-aware patterns for DE, EN, FR with support for various formats
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import type { Recognizer } from './base.js';

/**
 * Phone number patterns organized by region
 * All patterns use word boundaries and allow common separators
 */
const PHONE_PATTERNS = {
  // International format: +XX or 00XX followed by digits
  international: /(?<![0-9])(?:\+|00)[1-9][0-9]{6,14}(?![0-9])/g,

  // International with separators
  internationalFormatted:
    /(?<![0-9])(?:\+|00)[1-9][0-9]{0,2}[\s.-]?(?:\([0-9]{1,4}\)|[0-9]{1,4})[\s.-]?[0-9]{2,4}[\s.-]?[0-9]{2,4}(?:[\s.-]?[0-9]{2,4})?(?![0-9])/g,

  // German formats
  // Standard: 0XX XXXXXXX or 0XXXX XXXXX
  german: /(?<![0-9])0[1-9][0-9]{1,4}[\s/-]?[0-9]{3,8}(?![0-9])/g,
  // With area code in parentheses: (0XX) XXXXXXX
  germanParens: /(?<![0-9])\(0[1-9][0-9]{1,4}\)[\s]?[0-9]{3,8}(?![0-9])/g,

  // US/UK formats
  // US: (XXX) XXX-XXXX or XXX-XXX-XXXX
  usFormat: /(?<![0-9])(?:\([0-9]{3}\)[\s.-]?|[0-9]{3}[\s.-])[0-9]{3}[\s.-][0-9]{4}(?![0-9])/g,
  // UK: 0XXXX XXXXXX
  ukFormat: /(?<![0-9])0[1-9][0-9]{2,4}[\s][0-9]{5,6}(?![0-9])/g,

  // French formats: 0X XX XX XX XX or 0XXXXXXXXX
  french: /(?<![0-9])0[1-9][0-9]{8}(?![0-9])/g,
  frenchFormatted: /(?<![0-9])0[1-9](?:[\s.-]?[0-9]{2}){4}(?![0-9])/g,
};

/**
 * Minimum number of digits for a valid phone number
 */
const MIN_DIGITS = 7;

/**
 * Maximum number of digits for a valid phone number
 */
const MAX_DIGITS = 15;

/**
 * Phone number recognizer with multi-region support
 */
export const phoneRecognizer: Recognizer = {
  type: PIIType.PHONE,
  name: 'Phone Number',
  defaultConfidence: 0.9,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    const seen = new Set<string>();

    // Try each pattern
    for (const pattern of Object.values(PHONE_PATTERNS)) {
      const globalPattern = new RegExp(pattern.source, 'g');

      for (const match of text.matchAll(globalPattern)) {
        if (match.index === undefined) continue;

        const phone = match[0];
        const key = `${match.index}:${match.index + phone.length}`;

        // Skip duplicates (from overlapping patterns)
        if (seen.has(key)) continue;

        // Validate the match
        if (!this.validate!(phone)) continue;

        // Reject if embedded in a hex string (SHA256 hashes, Docker image IDs)
        // Require at least 2 consecutive hex-only chars [a-f] adjacent to the match
        const beforeStr = text.slice(Math.max(0, match.index - 2), match.index);
        const afterStr = text.slice(match.index + phone.length, match.index + phone.length + 2);
        if (/[a-f]{2}$/i.test(beforeStr) || /^[a-f]{2}/i.test(afterStr)) continue;

        seen.add(key);
        matches.push({
          type: PIIType.PHONE,
          start: match.index,
          end: match.index + phone.length,
          confidence: this.defaultConfidence,
          source: DetectionSource.REGEX,
          text: phone,
        });
      }
    }

    // Remove overlapping matches, keeping longer ones
    return deduplicateOverlapping(matches);
  },

  validate(phone: string): boolean {
    // Count digits
    const digits = phone.replace(/\D/g, '');

    // Check digit count
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
      return false;
    }

    // Should not be all same digit (e.g., 0000000000)
    if (/^(\d)\1+$/.test(digits)) {
      return false;
    }

    // Should not be sequential
    if (isSequential(digits)) {
      return false;
    }

    return true;
  },

  normalize(phone: string): string {
    // Remove all non-digit characters except leading +
    const hasPlus = phone.startsWith('+');
    const digits = phone.replace(/\D/g, '');
    return hasPlus ? '+' + digits : digits;
  },
};

/**
 * Check if a digit string is sequential (123456789 or 987654321)
 */
function isSequential(digits: string): boolean {
  if (digits.length < 5) return false;

  let ascending = true;
  let descending = true;

  for (let i = 1; i < digits.length; i++) {
    const prev = parseInt(digits[i - 1]!, 10);
    const curr = parseInt(digits[i]!, 10);

    if (curr !== prev + 1) ascending = false;
    if (curr !== prev - 1) descending = false;

    if (!ascending && !descending) return false;
  }

  return ascending || descending;
}

/**
 * Remove overlapping matches, keeping longer ones
 */
function deduplicateOverlapping(matches: SpanMatch[]): SpanMatch[] {
  if (matches.length <= 1) return matches;

  // Sort by start position
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const result: SpanMatch[] = [];

  for (const match of sorted) {
    // Check if this overlaps with the last added match
    const last = result[result.length - 1];

    if (last !== undefined && match.start < last.end) {
      // Overlapping - keep the longer one
      if (match.end - match.start > last.end - last.start) {
        result.pop();
        result.push(match);
      }
      // Otherwise keep the existing one
    } else {
      result.push(match);
    }
  }

  return result;
}

