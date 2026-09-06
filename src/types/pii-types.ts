/**
 * PII Type Enumeration
 * Defines all supported PII categories for detection and anonymization
 */
export enum PIIType {
  // Personal identifiers
  PERSON = 'PERSON',
  ORG = 'ORG',
  LOCATION = 'LOCATION',
  ADDRESS = 'ADDRESS',

  // Contact information
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  GITHUB_USERNAME = 'GITHUB_USERNAME',
  URL = 'URL',
  IP_ADDRESS = 'IP_ADDRESS',

  // Financial identifiers
  IBAN = 'IBAN',
  BIC_SWIFT = 'BIC_SWIFT',
  ACCOUNT_NUMBER = 'ACCOUNT_NUMBER',
  CREDIT_CARD = 'CREDIT_CARD',

  // Temporal
  DATE = 'DATE',

  // Government/Tax identifiers
  TAX_ID = 'TAX_ID',
  NATIONAL_ID = 'NATIONAL_ID',
  DATE_OF_BIRTH = 'DATE_OF_BIRTH',

  // Custom/Business identifiers
  CASE_ID = 'CASE_ID',
  CUSTOMER_ID = 'CUSTOMER_ID',

  // Secrets/Credentials
  API_KEY = 'API_KEY',
  PRIVATE_KEY = 'PRIVATE_KEY',
  JWT = 'JWT',
  CONNECTION_STRING = 'CONNECTION_STRING',
  AWS_CREDENTIALS = 'AWS_CREDENTIALS',
  ENV_VAR_SECRET = 'ENV_VAR_SECRET',
  CONFIG_SECRET = 'CONFIG_SECRET',
}

/**
 * All PII types as a readonly array for iteration
 */
export const ALL_PII_TYPES: readonly PIIType[] = Object.values(PIIType) as PIIType[];

/**
 * PII types that are detected via regex (structured PII)
 */
export const REGEX_PII_TYPES: readonly PIIType[] = [
  PIIType.EMAIL,
  PIIType.PHONE,
  PIIType.IBAN,
  PIIType.BIC_SWIFT,
  PIIType.CREDIT_CARD,
  PIIType.IP_ADDRESS,
  PIIType.URL,
  PIIType.ACCOUNT_NUMBER,
  PIIType.TAX_ID,
  PIIType.NATIONAL_ID,
  PIIType.DATE,
  PIIType.CASE_ID,
  PIIType.CUSTOMER_ID,
  PIIType.GITHUB_USERNAME,
];

/**
 * PII types that are secrets/credentials (opt-in, regex-based)
 */
export const SECRET_PII_TYPES: readonly PIIType[] = [
  PIIType.API_KEY,
  PIIType.PRIVATE_KEY,
  PIIType.JWT,
  PIIType.CONNECTION_STRING,
  PIIType.AWS_CREDENTIALS,
  PIIType.ENV_VAR_SECRET,
  PIIType.CONFIG_SECRET,
];

/**
 * PII types that are detected via NER model (soft PII)
 */
export const NER_PII_TYPES: readonly PIIType[] = [
  PIIType.PERSON,
  PIIType.ORG,
  PIIType.LOCATION,
  PIIType.ADDRESS,
  PIIType.DATE_OF_BIRTH,
];

/**
 * Default priority order for resolving overlapping entities
 * Higher index = higher priority
 */
export const DEFAULT_TYPE_PRIORITY: readonly PIIType[] = [
  // Lower priority (generic)
  PIIType.GITHUB_USERNAME,
  PIIType.URL,
  PIIType.IP_ADDRESS,
  PIIType.LOCATION,
  PIIType.ORG,
  PIIType.PERSON,
  // Medium priority
  PIIType.DATE,
  PIIType.DATE_OF_BIRTH,
  PIIType.PHONE,
  PIIType.EMAIL,
  PIIType.ADDRESS,
  // Higher priority (specific identifiers)
  PIIType.CASE_ID,
  PIIType.CUSTOMER_ID,
  PIIType.ACCOUNT_NUMBER,
  PIIType.BIC_SWIFT,
  PIIType.IBAN,
  PIIType.CREDIT_CARD,
  PIIType.TAX_ID,
  PIIType.NATIONAL_ID,
  // Highest priority (secrets/credentials)
  PIIType.ENV_VAR_SECRET,
  PIIType.CONFIG_SECRET,
  PIIType.CONNECTION_STRING,
  PIIType.AWS_CREDENTIALS,
  PIIType.API_KEY,
  PIIType.PRIVATE_KEY,
  PIIType.JWT,
];

/**
 * Maps NER model labels to PIIType
 * Common label formats from NER models (B-PER, I-PER, B-ORG, etc.)
 */
export const NER_LABEL_TO_PII_TYPE: Record<string, PIIType> = {
  PER: PIIType.PERSON,
  PERSON: PIIType.PERSON,
  ORG: PIIType.ORG,
  ORGANIZATION: PIIType.ORG,
  LOC: PIIType.LOCATION,
  LOCATION: PIIType.LOCATION,
  GPE: PIIType.LOCATION, // Geo-Political Entity
  DATE: PIIType.DATE,
  // Some models use MISC for addresses
  MISC: PIIType.ADDRESS,
};

/**
 * Get PIIType from NER label (handles B-/I- prefixes)
 */
export function getPIITypeFromNERLabel(label: string): PIIType | null {
  // Remove B-/I- prefix if present
  const cleanLabel = label.replace(/^[BI]-/, '').toUpperCase();

  if (cleanLabel === 'O') {
    return null; // Outside any entity
  }

  return NER_LABEL_TO_PII_TYPE[cleanLabel] ?? null;
}
