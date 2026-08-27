/**
 * Output Validator
 * Validates anonymized output and performs leak scan
 */

import { PIIType, DetectedEntity, AnonymizationPolicy, TagFormat, TagId, DEFAULT_TAG_FORMAT } from '../types/index.js';
import { spansOverlap } from '../utils/offsets.js';
import { extractTags, isValidTag } from './tagger.js';
import { escapeRegExp } from '../utils/regex.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of validation errors */
  errors: ValidationError[];
  /** Whether leak scan passed (if performed) */
  leakScanPassed?: boolean;
  /** Potential leaks found by leak scan */
  potentialLeaks?: LeakScanMatch[];
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error code */
  code: ValidationErrorCode;
  /** Human-readable message */
  message: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Validation error codes
 */
export enum ValidationErrorCode {
  OVERLAPPING_ENTITIES = 'OVERLAPPING_ENTITIES',
  DUPLICATE_IDS = 'DUPLICATE_IDS',
  MALFORMED_TAG = 'MALFORMED_TAG',
  ID_MISMATCH = 'ID_MISMATCH',
  MISSING_IN_MAP = 'MISSING_IN_MAP',
  POTENTIAL_PII_LEAK = 'POTENTIAL_PII_LEAK',
}

/**
 * Leak scan match
 */
export interface LeakScanMatch {
  /** Type of potential leak */
  type: PIIType;
  /** Matched text */
  text: string;
  /** Position in anonymized text */
  position: number;
  /** Pattern that matched */
  pattern: string;
}

/**
 * Leak scan patterns for common structured PII
 * These are simplified patterns for quick scanning
 */
const LEAK_SCAN_PATTERNS: Array<{ type: PIIType; pattern: RegExp; name: string }> = [
  {
    type: PIIType.EMAIL,
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    name: 'Email',
  },
  {
    type: PIIType.PHONE,
    pattern: /(?:\+|00)[1-9][0-9]{7,14}|0[1-9][0-9]{6,11}/g,
    name: 'Phone',
  },
  {
    type: PIIType.IBAN,
    pattern: /[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}/gi,
    name: 'IBAN',
  },
  {
    type: PIIType.CREDIT_CARD,
    pattern: /[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}/g,
    name: 'Credit Card',
  },
  {
    type: PIIType.IP_ADDRESS,
    pattern: /(?:\d{1,3}\.){3}\d{1,3}/g,
    name: 'IP Address',
  },
];

/**
 * Validates anonymization output
 */
export function validateOutput(
  anonymizedText: string,
  entities: DetectedEntity[],
  piiMapKeys: string[],
  policy: AnonymizationPolicy,
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate no overlapping entities
  const overlapErrors = checkOverlappingEntities(entities);
  errors.push(...overlapErrors);

  // Validate unique IDs (per type or globally)
  const idErrors = checkUniqueIds(entities);
  errors.push(...idErrors);

  // Validate tags in text are well-formed
  const tagErrors = checkTags(anonymizedText, tagFormat);
  errors.push(...tagErrors);

  // Validate tag count matches entity count
  const countErrors = checkTagEntityMatch(anonymizedText, entities, tagFormat);
  errors.push(...countErrors);

  // Validate all entities have entries in PII map
  const mapErrors = checkPIIMapCompleteness(entities, piiMapKeys);
  errors.push(...mapErrors);

  // Perform leak scan if enabled
  let leakScanPassed: boolean | undefined;
  let potentialLeaks: LeakScanMatch[] | undefined;

  if (policy.enableLeakScan) {
    const leakResult = performLeakScan(anonymizedText, policy, tagFormat);
    potentialLeaks = leakResult.matches;
    leakScanPassed = potentialLeaks.length === 0;

    if (!leakScanPassed) {
      errors.push({
        code: ValidationErrorCode.POTENTIAL_PII_LEAK,
        message: `Leak scan found ${potentialLeaks.length} potential PII leak(s)`,
        details: { leaks: potentialLeaks },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    leakScanPassed,
    potentialLeaks,
  };
}

/**
 * Checks for overlapping entities
 */
function checkOverlappingEntities(entities: DetectedEntity[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;

      if (spansOverlap(a, b)) {
        errors.push({
          code: ValidationErrorCode.OVERLAPPING_ENTITIES,
          message: `Entities ${a.id} (${a.type}) and ${b.id} (${b.type}) overlap`,
          details: {
            entity1: { id: a.id, type: a.type, start: a.start, end: a.end },
            entity2: { id: b.id, type: b.type, start: b.start, end: b.end },
          },
        });
      }
    }
  }

  return errors;
}

/**
 * Checks for duplicate IDs
 */
function checkUniqueIds(entities: DetectedEntity[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Map<TagId, DetectedEntity>();

  for (const entity of entities) {
    const existing = seenIds.get(entity.id);
    if (existing !== undefined) {
      // Duplicate ID - only an error if they have different original text
      // (reuse of IDs for same text is allowed with policy.reuseIdsForRepeatedPII)
      if (existing.original !== entity.original) {
        errors.push({
          code: ValidationErrorCode.DUPLICATE_IDS,
          message: `Duplicate ID ${entity.id} used for different text values`,
          details: {
            id: entity.id,
            first: { type: existing.type, text: existing.original },
            second: { type: entity.type, text: entity.original },
          },
        });
      }
    } else {
      seenIds.set(entity.id, entity);
    }
  }

  return errors;
}

/**
 * Checks that all tags in text are well-formed
 */
function checkTags(
  anonymizedText: string,
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): ValidationError[] {
  const errors: ValidationError[] = [];
  const keyword = tagFormat.keyword ?? "PII";
  const escapedOpen = escapeRegExp(tagFormat.open);
  const escapedClose = escapeRegExp(tagFormat.close);

  // Find anything that looks like a PII tag
  // Build pattern: OPEN KEYWORD ... CLOSE
  // Use negated char class on close delimiter's first char to prevent matching across tags
  const boundChar = escapeRegExp(tagFormat.close[0]!);
  const escapedKeyword = escapeRegExp(keyword);
  const tagLikePattern = new RegExp(
    `${escapedOpen}${escapedKeyword}[^${boundChar}]*${escapedClose}`,
    "g"
  );
  let match: RegExpExecArray | null;

  while ((match = tagLikePattern.exec(anonymizedText)) !== null) {
    if (!isValidTag(match[0], tagFormat)) {
      // For XML-style "/>", the regex may capture up to ">" without the leading "/",
      // so try appending the close delimiter to see if the tag is actually valid.
      // This only applies to XML-style where open/close are asymmetric.
      if (tagFormat.close === "/>") {
        const fullTag = match[0] + tagFormat.close;
        if (isValidTag(fullTag, tagFormat)) continue;
      }
      errors.push({
        code: ValidationErrorCode.MALFORMED_TAG,
        message: `Malformed PII tag at position ${match.index}`,
        details: { tag: match[0], position: match.index },
      });
    }
  }

  return errors;
}

/**
 * Checks that tag count matches entity count
 */
function checkTagEntityMatch(
  anonymizedText: string,
  entities: DetectedEntity[],
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): ValidationError[] {
  const errors: ValidationError[] = [];
  const tags = extractTags(anonymizedText, tagFormat);

  // Get unique entity IDs
  const entityIds = new Set(entities.map((e) => e.id));
  const tagIds = new Set(tags.map((t) => t.id));

  // Check for mismatches
  for (const id of entityIds) {
    if (!tagIds.has(id)) {
      errors.push({
        code: ValidationErrorCode.ID_MISMATCH,
        message: `Entity ID ${id} not found in anonymized text`,
        details: { missingId: id },
      });
    }
  }

  return errors;
}

/**
 * Checks that all entities have entries in PII map
 */
function checkPIIMapCompleteness(
  entities: DetectedEntity[],
  piiMapKeys: string[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const keySet = new Set(piiMapKeys);

  for (const entity of entities) {
    const expectedKey = `${entity.type}_${entity.id}`;
    if (!keySet.has(expectedKey)) {
      errors.push({
        code: ValidationErrorCode.MISSING_IN_MAP,
        message: `Entity ${entity.id} (${entity.type}) missing from PII map`,
        details: { entityId: entity.id, entityType: entity.type, expectedKey },
      });
    }
  }

  return errors;
}

/**
 * Performs leak scan on anonymized text
 */
function performLeakScan(
  anonymizedText: string,
  policy: AnonymizationPolicy,
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): { matches: LeakScanMatch[] } {
  const matches: LeakScanMatch[] = [];

  // Skip scanning inside PII tags
  const keyword = tagFormat.keyword ?? "PII";
  const boundChar = escapeRegExp(tagFormat.close[0]!);
  const tagStripPattern = new RegExp(
    `${escapeRegExp(tagFormat.open)}${escapeRegExp(keyword)}[^${boundChar}]*${escapeRegExp(tagFormat.close)}`,
    "g"
  );
  const textWithoutTags = anonymizedText.replace(tagStripPattern, ' '.repeat(20));

  for (const { type, pattern, name } of LEAK_SCAN_PATTERNS) {
    // Skip if type not enabled in policy
    if (!policy.enabledTypes.has(type)) {
      continue;
    }

    const globalPattern = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(textWithoutTags)) !== null) {
      // Double-check this isn't inside a tag
      const position = match.index;
      const isInTag = isPositionInsideTag(anonymizedText, position, tagFormat);

      if (!isInTag) {
        matches.push({
          type,
          text: match[0],
          position,
          pattern: name,
        });
      }
    }
  }

  return { matches };
}

/**
 * Checks if a position is inside a PII tag
 */
function isPositionInsideTag(
  text: string,
  position: number,
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): boolean {
  const open = tagFormat.open;
  const close = tagFormat.close;
  const keyword = tagFormat.keyword ?? "PII";
  const prefix = open + keyword;

  // Find the nearest tag-like open (open + keyword) before position
  const before = text.lastIndexOf(prefix, position);
  if (before === -1) return false;

  // Find the nearest close delimiter after the open
  const after = text.indexOf(close, before + prefix.length);
  if (after === -1) return false;

  // Position is inside tag if it's between open and close
  return position > before && position < after + close.length;
}

/**
 * Validates that no overlaps exist (fast check)
 */
export function hasNoOverlaps(entities: Array<{ start: number; end: number }>): boolean {
  if (entities.length <= 1) return true;

  const sorted = [...entities].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i]!.end > sorted[i + 1]!.start) {
      return false;
    }
  }

  return true;
}

