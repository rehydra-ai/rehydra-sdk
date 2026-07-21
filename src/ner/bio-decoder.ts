/**
 * BIO Tag Decoder
 * Converts BIO-tagged token sequences to entity spans
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import { getPIITypeFromNERLabel } from '../types/pii-types.js';
import type { Token } from './tokenizer.js';

/**
 * BIO tag types
 */
export enum BIOTag {
  /** Beginning of an entity */
  B = 'B',
  /** Inside an entity (continuation) */
  I = 'I',
  /** Outside any entity */
  O = 'O',
}

/**
 * Parsed BIO label
 */
export interface ParsedBIOLabel {
  /** BIO tag type */
  tag: BIOTag;
  /** Entity type (null for O tag) */
  entityType: string | null;
}

/**
 * Raw entity span from NER (before conversion to SpanMatch)
 */
export interface RawNEREntity {
  /** Entity type string from model */
  type: string;
  /** Start character offset */
  start: number;
  /** End character offset */
  end: number;
  /** Combined confidence score */
  confidence: number;
  /** Raw text */
  text: string;
  /** Token indices that make up this entity */
  tokenIndices: number[];
}

/**
 * Parses a BIO label string (e.g., "B-PER", "I-ORG", "O")
 */
export function parseBIOLabel(label: string): ParsedBIOLabel {
  if (label === 'O' || label === '[PAD]' || label === '[CLS]' || label === '[SEP]') {
    return { tag: BIOTag.O, entityType: null };
  }

  const parts = label.split('-');
  if (parts.length !== 2) {
    return { tag: BIOTag.O, entityType: null };
  }

  const [tagStr, entityType] = parts;

  let tag: BIOTag;
  switch (tagStr?.toUpperCase()) {
    case 'B':
      tag = BIOTag.B;
      break;
    case 'I':
      tag = BIOTag.I;
      break;
    default:
      return { tag: BIOTag.O, entityType: null };
  }

  return { tag, entityType: entityType ?? null };
}

/**
 * Decodes BIO-tagged tokens into entity spans
 */
export function decodeBIOTags(
  tokens: Token[],
  labels: string[],
  confidences: number[],
  originalText: string
): RawNEREntity[] {
  const entities: RawNEREntity[] = [];
  let currentEntity: RawNEREntity | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const label = labels[i] ?? 'O';
    const confidence = confidences[i] ?? 0;

    // Skip special tokens
    if (token.isSpecial) {
      // If we have a current entity, close it
      if (currentEntity !== null) {
        entities.push(currentEntity);
        currentEntity = null;
      }
      continue;
    }

    const { tag, entityType } = parseBIOLabel(label);

    switch (tag) {
      case BIOTag.B:
        // Start of new entity
        // Close previous entity if exists
        if (currentEntity !== null) {
          entities.push(currentEntity);
        }

        currentEntity = {
          type: entityType ?? 'UNKNOWN',
          start: token.start,
          end: token.end,
          confidence,
          text: originalText.slice(token.start, token.end),
          tokenIndices: [i],
        };
        break;

      case BIOTag.I:
        // Continuation of entity
        if (currentEntity !== null && entityType === currentEntity.type) {
          // Extend current entity
          currentEntity.end = token.end;
          currentEntity.text = originalText.slice(currentEntity.start, currentEntity.end);
          currentEntity.tokenIndices.push(i);
          // Average confidence
          currentEntity.confidence =
            (currentEntity.confidence * (currentEntity.tokenIndices.length - 1) + confidence) /
            currentEntity.tokenIndices.length;
        } else {
          // I tag without matching B tag - treat as new entity (common in some models)
          if (currentEntity !== null) {
            entities.push(currentEntity);
          }
          currentEntity = {
            type: entityType ?? 'UNKNOWN',
            start: token.start,
            end: token.end,
            confidence,
            text: originalText.slice(token.start, token.end),
            tokenIndices: [i],
          };
        }
        break;

      case BIOTag.O:
        // Outside entity - close current if exists
        if (currentEntity !== null) {
          entities.push(currentEntity);
          currentEntity = null;
        }
        break;
    }
  }

  // Don't forget to close the last entity
  if (currentEntity !== null) {
    entities.push(currentEntity);
  }

  return entities;
}

/**
 * Converts raw NER entities to SpanMatch format
 */
export function convertToSpanMatches(
  rawEntities: RawNEREntity[],
  confidenceThreshold: number = 0.5
): SpanMatch[] {
  const spans: SpanMatch[] = [];

  for (const entity of rawEntities) {
    // Filter by confidence
    if (entity.confidence < confidenceThreshold) {
      continue;
    }

    // Map entity type to PIIType
    const piiType = getPIITypeFromNERLabel(entity.type);
    if (piiType === null) {
      continue; // Skip unknown types
    }

    spans.push({
      type: piiType,
      start: entity.start,
      end: entity.end,
      confidence: entity.confidence,
      source: DetectionSource.NER,
      text: entity.text,
    });
  }

  return spans;
}

/**
 * Post-processes NER spans to clean up boundaries
 */
export function cleanupSpanBoundaries(
  spans: SpanMatch[],
  originalText: string
): SpanMatch[] {
  return spans.map((span) => {
    let { start, end } = span;

    // Trim leading whitespace
    while (start < end && /\s/.test(originalText[start] ?? '')) {
      start++;
    }

    // Trim trailing whitespace
    while (end > start && /\s/.test(originalText[end - 1] ?? '')) {
      end--;
    }

    // Trim leading/trailing punctuation for PERSON/ORG types
    if (span.type === PIIType.PERSON || span.type === PIIType.ORG) {
      while (start < end && /[.,;:!?'"()]/.test(originalText[start] ?? '')) {
        start++;
      }
      while (end > start && /[.,;:!?'"()]/.test(originalText[end - 1] ?? '')) {
        end--;
      }
    }

    // If span became empty, return original
    if (start >= end) {
      return span;
    }

    return {
      ...span,
      start,
      end,
      text: originalText.slice(start, end),
    };
  });
}

/**
 * Merges adjacent spans of the same type
 */
export function mergeAdjacentSpans(
  spans: SpanMatch[],
  originalText: string,
  maxGap: number = 1
): SpanMatch[] {
  if (spans.length <= 1) return spans;

  // Sort by start position
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: SpanMatch[] = [];

  let current = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;

    // Check if same type and close enough
    const gap = next.start - current.end;
    const gapText = originalText.slice(current.end, next.start);
    const isOnlyWhitespace = /^\s*$/.test(gapText);

    if (next.type === current.type && gap <= maxGap && isOnlyWhitespace) {
      // Merge spans; max() so a span contained in the current one
      // (possible with overlapping inputs) can never shrink the result
      const mergedEnd = Math.max(current.end, next.end);
      current = {
        ...current,
        end: mergedEnd,
        text: originalText.slice(current.start, mergedEnd),
        confidence: (current.confidence + next.confidence) / 2,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

