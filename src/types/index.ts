import { PIIType, DEFAULT_TYPE_PRIORITY } from "./pii-types.js";

export * from "./pii-types.js";

/**
 * Source of entity detection
 */
export enum DetectionSource {
  REGEX = "REGEX",
  NER = "NER",
  HYBRID = "HYBRID",
}

// ============================================================================
// Semantic Attributes for MT-friendly PII tags
// ============================================================================

/**
 * Gender attribute for PERSON entities
 * Used to preserve grammatical agreement during machine translation
 */
export type PersonGender = "male" | "female" | "neutral" | "unknown";

/**
 * Scope attribute for LOCATION entities
 * Helps MT engines select correct prepositions (e.g., "in Berlin" vs "in Germany")
 */
export type LocationScope = "city" | "country" | "region" | "unknown";

/**
 * Semantic attributes for PII entities
 * These attributes help preserve linguistic context during translation
 */
export interface SemanticAttributes {
  /** Gender for PERSON entities */
  gender?: PersonGender;
  /** Geographic scope for LOCATION entities */
  scope?: LocationScope;
  /** Honorific title extracted from PERSON entities (e.g., "Dr.", "Mrs.") */
  title?: string;
}

/**
 * Progress callback for semantic data downloads
 */
export type SemanticDownloadProgressCallback = (progress: {
  file: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number | null;
}) => void;

/**
 * Semantic enrichment configuration
 * Controls automatic downloading and loading of semantic data for MT-friendly PII tags
 */
export interface SemanticConfig {
  /**
   * Whether to enable semantic masking (adds gender/scope attributes to PII tags)
   * @default false
   */
  enabled: boolean;

  /**
   * Whether to auto-download semantic data if not present
   * Data files include name-gender mappings (~40K names) and location data (~25K cities)
   * Total download size: ~4 MB
   * @default true when enabled is true
   */
  autoDownload?: boolean;

  /**
   * Callback for download progress
   */
  onDownloadProgress?: SemanticDownloadProgressCallback;

  /**
   * Callback for status messages
   */
  onStatus?: (status: string) => void;
}

/**
 * A detected PII entity with its position and metadata
 */
export interface DetectedEntity {
  /** PII category */
  type: PIIType;
  /** Unique identifier within the document (1-based, monotonically increasing) */
  id: number;
  /** Start character offset in original text (0-based, inclusive) */
  start: number;
  /** End character offset in original text (0-based, exclusive) */
  end: number;
  /** Detection confidence score (0.0 to 1.0) */
  confidence: number;
  /** How this entity was detected */
  source: DetectionSource;
  /** Original text (only stored in encrypted pii_map, never logged) */
  original: string;
  /** Semantic attributes for MT-friendly tags (gender, scope, etc.) */
  semantic?: SemanticAttributes;
}

/**
 * A span match from a recognizer (before ID assignment)
 */
export interface SpanMatch {
  /** PII category */
  type: PIIType;
  /** Start character offset (0-based, inclusive) */
  start: number;
  /** End character offset (0-based, exclusive) */
  end: number;
  /** Detection confidence score (0.0 to 1.0) */
  confidence: number;
  /** How this span was detected */
  source: DetectionSource;
  /** The matched text */
  text: string;
  /** Semantic attributes for MT-friendly tags (gender, scope, etc.) */
  semantic?: SemanticAttributes;
}

/**
 * Custom ID pattern configuration
 */
export interface CustomIdPattern {
  /** Pattern name for identification */
  name: string;
  /** Regular expression pattern */
  pattern: RegExp;
  /** PII type to assign (typically CASE_ID or CUSTOMER_ID) */
  type: PIIType;
  /** Optional validation function */
  validate?: (match: string) => boolean;
}

/**
 * Anonymization policy configuration
 */
export interface AnonymizationPolicy {
  /** Set of PII types to detect (both regex and NER) */
  enabledTypes: Set<PIIType>;
  /** Set of PII types to detect via regex */
  regexEnabledTypes: Set<PIIType>;
  /** Set of PII types to detect via NER */
  nerEnabledTypes: Set<PIIType>;
  /** Priority order for resolving overlapping entities (higher index = higher priority) */
  typePriority: PIIType[];
  /** Minimum confidence thresholds per type (default: 0.5) */
  confidenceThresholds: Map<PIIType, number>;
  /** Custom ID patterns for domain-specific identifiers */
  customIdPatterns: CustomIdPattern[];
  /** Terms that should not be treated as PII (case-insensitive) */
  allowlistTerms: Set<string>;
  /** Terms that should always be treated as PII */
  denylistPatterns: RegExp[];
  /** Whether to reuse IDs for identical repeated PII strings */
  reuseIdsForRepeatedPII: boolean;
  /** Whether to run leak scan on anonymized output */
  enableLeakScan: boolean;
  /** Enable semantic attribute enrichment for MT-friendly tags (gender, location scope) */
  enableSemanticMasking: boolean;
}

/**
 * Encrypted PII map entry
 */
export interface EncryptedPIIMap {
  /** AES-256-GCM encrypted data (base64) */
  ciphertext: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Authentication tag (base64) */
  authTag: string;
}

/**
 * Statistics about the anonymization process
 */
export interface AnonymizationStats {
  /** Count of entities detected per type */
  countsByType: Record<PIIType, number>;
  /** Total number of entities detected */
  totalEntities: number;
  /** NER model version used */
  modelVersion: string;
  /** Policy version/identifier */
  policyVersion: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Whether leak scan passed (if enabled) */
  leakScanPassed?: boolean;
}

/**
 * Result of the anonymization process
 */
export interface AnonymizationResult {
  /** Text with PII replaced by placeholder tags */
  anonymizedText: string;
  /** List of detected entities (without original text for safety) */
  entities: Omit<DetectedEntity, "original">[];
  /** Encrypted mapping of (type, id) -> original string */
  piiMap: EncryptedPIIMap;
  /** Statistics about the anonymization */
  stats: AnonymizationStats;
}

/**
 * Creates a default anonymization policy with all types enabled
 */
export function createDefaultPolicy(): AnonymizationPolicy {
  const allTypes = new Set(Object.values(PIIType) as PIIType[]);

  const defaultThresholds = new Map<PIIType, number>();
  for (const type of allTypes) {
    // Higher threshold for NER-detected types (more uncertainty)
    defaultThresholds.set(
      type,
      type === PIIType.PERSON || type === PIIType.ORG ? 0.7 : 0.5
    );
  }

  return {
    enabledTypes: allTypes,
    regexEnabledTypes: new Set([
      PIIType.EMAIL,
      PIIType.PHONE,
      PIIType.IBAN,
      PIIType.BIC_SWIFT,
      PIIType.CREDIT_CARD,
      PIIType.IP_ADDRESS,
      PIIType.URL,
      PIIType.CASE_ID,
      PIIType.CUSTOMER_ID,
    ]),
    nerEnabledTypes: new Set([
      PIIType.PERSON,
      PIIType.ORG,
      PIIType.LOCATION,
      PIIType.ADDRESS,
      PIIType.DATE_OF_BIRTH,
    ]),
    typePriority: [...DEFAULT_TYPE_PRIORITY],
    confidenceThresholds: defaultThresholds,
    customIdPatterns: [],
    allowlistTerms: new Set(),
    denylistPatterns: [],
    reuseIdsForRepeatedPII: false,
    enableLeakScan: true,
    enableSemanticMasking: false,
  };
}

/**
 * Merges a partial policy with defaults
 */
export function mergePolicy(
  partial: Partial<AnonymizationPolicy>
): AnonymizationPolicy {
  const defaultPolicy = createDefaultPolicy();

  return {
    enabledTypes: partial.enabledTypes ?? defaultPolicy.enabledTypes,
    regexEnabledTypes:
      partial.regexEnabledTypes ?? defaultPolicy.regexEnabledTypes,
    nerEnabledTypes: partial.nerEnabledTypes ?? defaultPolicy.nerEnabledTypes,
    typePriority: partial.typePriority ?? defaultPolicy.typePriority,
    confidenceThresholds:
      partial.confidenceThresholds ?? defaultPolicy.confidenceThresholds,
    customIdPatterns:
      partial.customIdPatterns ?? defaultPolicy.customIdPatterns,
    allowlistTerms: partial.allowlistTerms ?? defaultPolicy.allowlistTerms,
    denylistPatterns:
      partial.denylistPatterns ?? defaultPolicy.denylistPatterns,
    reuseIdsForRepeatedPII:
      partial.reuseIdsForRepeatedPII ?? defaultPolicy.reuseIdsForRepeatedPII,
    enableLeakScan: partial.enableLeakScan ?? defaultPolicy.enableLeakScan,
    enableSemanticMasking:
      partial.enableSemanticMasking ?? defaultPolicy.enableSemanticMasking,
  };
}
