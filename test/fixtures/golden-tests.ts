/**
 * Golden Test Fixtures
 * Expected inputs and outputs for comprehensive testing
 */

import { PIIType } from '../../src/types/index.js';

export interface GoldenTestCase {
  name: string;
  input: string;
  expectedTypes: PIIType[];
  expectedCount: number;
  description?: string;
}

/**
 * Golden test cases with expected outputs
 */
export const GOLDEN_TESTS: GoldenTestCase[] = [
  // Email tests
  {
    name: 'simple-email',
    input: 'Contact us at hello@example.com for more info.',
    expectedTypes: [PIIType.EMAIL],
    expectedCount: 1,
    description: 'Simple email in sentence',
  },
  {
    name: 'multiple-emails',
    input: 'Send to john@company.org and jane@company.org',
    expectedTypes: [PIIType.EMAIL, PIIType.EMAIL],
    expectedCount: 2,
    description: 'Multiple emails in one sentence',
  },
  {
    name: 'email-with-subdomain',
    input: 'Email: support@mail.example.co.uk',
    expectedTypes: [PIIType.EMAIL],
    expectedCount: 1,
    description: 'Email with subdomain and country TLD',
  },

  // Phone tests
  {
    name: 'german-phone',
    input: 'Telefon: +49 30 12345678',
    expectedTypes: [PIIType.PHONE],
    expectedCount: 1,
    description: 'German phone number with country code',
  },
  {
    name: 'us-phone',
    input: 'Call (555) 123-4567 for support',
    expectedTypes: [PIIType.PHONE],
    expectedCount: 1,
    description: 'US format phone number',
  },

  // IBAN tests
  {
    name: 'german-iban',
    input: 'IBAN: DE89370400440532013000',
    expectedTypes: [PIIType.IBAN],
    expectedCount: 1,
    description: 'German IBAN',
  },
  {
    name: 'iban-with-spaces',
    input: 'Transfer to DE89 3704 0044 0532 0130 00',
    expectedTypes: [PIIType.IBAN],
    expectedCount: 1,
    description: 'IBAN with space formatting',
  },

  // Credit card tests
  {
    name: 'visa-card',
    input: 'Card: 4111111111111111',
    expectedTypes: [PIIType.CREDIT_CARD],
    expectedCount: 1,
    description: 'Visa test card number',
  },
  {
    name: 'card-with-dashes',
    input: 'Pay with 4111-1111-1111-1111',
    expectedTypes: [PIIType.CREDIT_CARD],
    expectedCount: 1,
    description: 'Card number with dashes',
  },

  // IP Address tests
  {
    name: 'ipv4',
    input: 'Server at 203.0.113.42',
    expectedTypes: [PIIType.IP_ADDRESS],
    expectedCount: 1,
    description: 'IPv4 address (public IP)',
  },

  // URL tests
  {
    name: 'https-url',
    input: 'Visit https://example.com/path',
    expectedTypes: [PIIType.URL],
    expectedCount: 1,
    description: 'HTTPS URL',
  },

  // Mixed PII tests
  {
    name: 'mixed-pii',
    input: 'Contact john@example.com at +49 30 12345678. Payment to DE89370400440532013000',
    expectedTypes: [PIIType.EMAIL, PIIType.PHONE, PIIType.IBAN],
    expectedCount: 3,
    description: 'Multiple PII types in one text',
  },
  {
    name: 'business-letter',
    input: `Dear Customer,

Your order #12345 has been processed.
Contact: support@company.com
Phone: +49 30 98765432
Bank: DE89370400440532013000

Best regards,
Customer Service`,
    expectedTypes: [PIIType.EMAIL, PIIType.PHONE, PIIType.IBAN],
    expectedCount: 3,
    description: 'Business letter with multiple PII',
  },

  // Edge cases
  {
    name: 'no-pii',
    input: 'This is a normal sentence without any personal information.',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Text without PII',
  },
  {
    name: 'empty-string',
    input: '',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Empty string',
  },
  {
    name: 'unicode-text',
    input: 'Kontakt: müller@beispiel.de',
    expectedTypes: [PIIType.EMAIL],
    expectedCount: 1,
    description: 'Text with Unicode characters',
  },
];

/**
 * Adversarial test cases (false positives to avoid)
 */
export const ADVERSARIAL_TESTS: GoldenTestCase[] = [
  {
    name: 'version-numbers',
    input: 'Version 1.2.3.4 released',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Version number should not match IP',
  },
  {
    name: 'code-like-email',
    input: 'variable@annotation in code',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Code annotation should not match email',
  },
  {
    name: 'short-number',
    input: 'Code: 12345',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Short number should not match phone',
  },
  {
    name: 'invalid-iban-checksum',
    input: 'IBAN: DE00000000000000000000',
    expectedTypes: [],
    expectedCount: 0,
    description: 'Invalid IBAN checksum should not match',
  },
];

