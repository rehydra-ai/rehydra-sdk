/**
 * Custom ID Recognizer
 * Configurable recognizer for domain-specific identifiers
 * (Case IDs, Customer IDs, File References, etc.)
 */

import { PIIType, SpanMatch, DetectionSource, CustomIdPattern } from '../types/index.js';
import type { Recognizer } from './base.js';

/**
 * Creates a custom ID recognizer from patterns defined in policy.
 * It registers under its first pattern's type; each match keeps its
 * pattern's type, and the registry checks that type against the policy.
 */
export function createCustomIdRecognizer(patterns: CustomIdPattern[]): Recognizer {
  return {
    type: patterns[0]?.type ?? PIIType.CASE_ID,
    name: 'Custom ID',
    defaultConfidence: 0.9,

    find(text: string): SpanMatch[] {
      const matches: SpanMatch[] = [];
      const seen = new Set<string>();

      for (const patternConfig of patterns) {
        const { pattern, type, validate } = patternConfig;

        // Ensure pattern has global flag
        const globalPattern = pattern.global
          ? pattern
          : new RegExp(pattern.source, pattern.flags + 'g');

        for (const match of text.matchAll(globalPattern)) {
          if (match.index === undefined) continue;

          const idText = match[0];
          const key = `${match.index}:${match.index + idText.length}`;

          if (seen.has(key)) continue;

          // Run custom validation if provided
          if (validate !== undefined && !validate(idText)) {
            continue;
          }

          seen.add(key);
          matches.push({
            type,
            start: match.index,
            end: match.index + idText.length,
            confidence: 0.9,
            source: DetectionSource.REGEX,
            text: idText,
          });
        }
      }

      return matches;
    },
  };
}

/**
 * Common patterns for banking/government IDs that can be used as templates
 */
export const COMMON_ID_PATTERNS: Record<string, RegExp> = {
  // German case/file reference patterns
  germanCaseId: /\b[A-Z]{2,3}[\s-]?[0-9]{4,10}[\s-]?[A-Z0-9]{0,4}\b/g,

  // Generic case number (e.g., CASE-12345, CASE-2024-001, REF-2024/00123).
  // Every segment must contain a digit so words such as "reference",
  // "filesystem" or "case-study" stay untouched.
  genericCaseNumber:
    /\b(?:CASE|FILE|REF|TICKET)[\s-]?(?=[A-Z]*\d)[A-Z0-9]{4,12}(?:[-/](?=[A-Z]*\d)[A-Z0-9]{1,12}){0,4}\b/gi,

  // Customer number patterns
  customerNumber: /\b(?:CUST|CUSTOMER|KD|KUNDEN)[\s-]?(?:NR|NO|NUM|NUMBER)?[\s-]?[0-9]{4,12}\b/gi,

  // Account reference (non-IBAN)
  accountReference: /\b(?:ACC|ACCT|KONTO)[\s-]?[0-9]{6,12}\b/gi,

  // Invoice/Order numbers
  invoiceNumber: /\b(?:INV|INVOICE|RG|RECHNUNG)[\s-]?[A-Z0-9]{4,12}\b/gi,
  orderNumber: /\b(?:ORD|ORDER|BESTELLUNG)[\s-]?[A-Z0-9]{4,12}\b/gi,

  // Policy/Contract numbers
  policyNumber: /\b(?:POL|POLICY|VERTRAG)[\s-]?[A-Z0-9]{6,15}\b/gi,

  // Social Security / Tax ID patterns (generic)
  taxIdGeneric: /\b[0-9]{2,3}[\s/-]?[0-9]{2,4}[\s/-]?[0-9]{2,4}[\s/-]?[0-9]{1,4}\b/g,
};

/**
 * Creates a standard case ID recognizer
 */
export function createCaseIdRecognizer(): Recognizer {
  return createCustomIdRecognizer([
    {
      name: 'German Case ID',
      pattern: COMMON_ID_PATTERNS['germanCaseId']!,
      type: PIIType.CASE_ID,
    },
    {
      name: 'Generic Case Number',
      pattern: COMMON_ID_PATTERNS['genericCaseNumber']!,
      type: PIIType.CASE_ID,
    },
  ]);
}

/**
 * Creates a standard customer ID recognizer
 */
export function createCustomerIdRecognizer(): Recognizer {
  return createCustomIdRecognizer([
    {
      name: 'Customer Number',
      pattern: COMMON_ID_PATTERNS['customerNumber']!,
      type: PIIType.CUSTOMER_ID,
    },
  ]);
}

/**
 * Validates that a string looks like a structured ID (not just random text)
 */
export function isStructuredId(text: string): boolean {
  // Should have at least some digits
  const digitCount = (text.match(/\d/g) ?? []).length;
  if (digitCount < 3) return false;

  // Should not be all letters or all digits
  const letterCount = (text.match(/[a-zA-Z]/g) ?? []).length;
  const totalAlphanumeric = digitCount + letterCount;

  // Most of the characters should be alphanumeric
  const cleanText = text.replace(/[\s\-_]/g, '');
  if (totalAlphanumeric / cleanText.length < 0.9) return false;

  return true;
}

