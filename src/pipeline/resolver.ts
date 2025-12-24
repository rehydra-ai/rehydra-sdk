/**
 * Entity Resolver
 * Merges, deduplicates, and resolves overlapping entity detections
 */

import {
  PIIType,
  SpanMatch,
  DetectionSource,
  AnonymizationPolicy,
  DEFAULT_TYPE_PRIORITY,
} from '../types/index.js';
import { spansOverlap, spanLength, sortSpansByPosition } from '../utils/offsets.js';

/**
 * Resolution strategy for overlapping entities
 */
export enum OverlapStrategy {
  /** Regex matches always win over NER */
  REGEX_PRIORITY = 'REGEX_PRIORITY',
  /** Longer span wins */
  LONGER_SPAN = 'LONGER_SPAN',
  /** Higher confidence wins */
  HIGHER_CONFIDENCE = 'HIGHER_CONFIDENCE',
  /** Use type priority from policy */
  TYPE_PRIORITY = 'TYPE_PRIORITY',
}

/**
 * Entity resolver configuration
 */
export interface ResolverConfig {
  /** Primary strategy for overlap resolution */
  overlapStrategy: OverlapStrategy;
  /** Whether regex matches always take precedence */
  regexPriority: boolean;
  /** Minimum confidence to keep an entity */
  minConfidence: number;
}

/**
 * Default resolver configuration
 */
export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = {
  overlapStrategy: OverlapStrategy.REGEX_PRIORITY,
  regexPriority: true,
  minConfidence: 0.5,
};

/**
 * Resolves and merges entity detections from regex and NER
 */
export function resolveEntities(
  regexMatches: SpanMatch[],
  nerMatches: SpanMatch[],
  policy: AnonymizationPolicy,
  originalText: string,
  config: Partial<ResolverConfig> = {}
): SpanMatch[] {
  const resolverConfig = { ...DEFAULT_RESOLVER_CONFIG, ...config };

  // Step 1: Filter by enabled types and confidence thresholds
  const filteredRegex = filterByPolicy(regexMatches, policy);
  const filteredNER = filterByPolicy(nerMatches, policy);

  // Step 2: Apply allowlist filtering
  const allowlistFilteredRegex = applyAllowlist(filteredRegex, policy, originalText);
  const allowlistFilteredNER = applyAllowlist(filteredNER, policy, originalText);

  // Step 3: Combine all matches
  const allMatches = [...allowlistFilteredRegex, ...allowlistFilteredNER];

  // Step 4: Remove overlaps based on strategy
  const resolved = removeOverlaps(allMatches, policy, resolverConfig);

  // Step 5: Apply denylist patterns (force include)
  const withDenylist = applyDenylist(resolved, policy, originalText);

  // Step 6: Final deduplication
  const deduplicated = deduplicateExact(withDenylist);

  // Step 7: Sort by position
  return sortSpansByPosition(deduplicated);
}

/**
 * Filters matches by policy (enabled types and confidence thresholds)
 */
function filterByPolicy(matches: SpanMatch[], policy: AnonymizationPolicy): SpanMatch[] {
  return matches.filter((match) => {
    // Check if type is enabled
    if (!policy.enabledTypes.has(match.type)) {
      return false;
    }

    // Check confidence threshold
    const threshold = policy.confidenceThresholds.get(match.type) ?? 0.5;
    if (match.confidence < threshold) {
      return false;
    }

    return true;
  });
}

/**
 * Filters out matches that are in the allowlist (known non-PII terms)
 */
function applyAllowlist(
  matches: SpanMatch[],
  policy: AnonymizationPolicy,
  _originalText: string
): SpanMatch[] {
  if (policy.allowlistTerms.size === 0) {
    return matches;
  }

  return matches.filter((match) => {
    const matchText = match.text.toLowerCase().trim();
    return !policy.allowlistTerms.has(matchText);
  });
}

/**
 * Adds matches from denylist patterns (patterns that must always be PII)
 */
function applyDenylist(
  matches: SpanMatch[],
  policy: AnonymizationPolicy,
  originalText: string
): SpanMatch[] {
  if (policy.denylistPatterns.length === 0) {
    return matches;
  }

  const denylistMatches: SpanMatch[] = [];

  for (const pattern of policy.denylistPatterns) {
    const globalPattern = pattern.global
      ? pattern
      : new RegExp(pattern.source, pattern.flags + 'g');

    for (const match of originalText.matchAll(globalPattern)) {
      if (match.index === undefined) continue;

      // Check if this is already covered by existing matches
      const matchIndex = match.index;
      const alreadyCovered = matches.some(
        (existing) =>
          existing.start <= matchIndex &&
          existing.end >= matchIndex + match[0].length
      );

      if (!alreadyCovered) {
        denylistMatches.push({
          type: PIIType.EMAIL, // Default type for denylist; could be configurable
          start: match.index,
          end: match.index + match[0].length,
          confidence: 1.0,
          source: DetectionSource.REGEX,
          text: match[0],
        });
      }
    }
  }

  return [...matches, ...denylistMatches];
}

/**
 * Removes overlapping spans based on resolution strategy
 */
function removeOverlaps(
  matches: SpanMatch[],
  policy: AnonymizationPolicy,
  config: ResolverConfig
): SpanMatch[] {
  if (matches.length <= 1) {
    return matches;
  }

  // Sort by start position
  const sorted = sortSpansByPosition(matches);
  const result: SpanMatch[] = [];

  for (const match of sorted) {
    // Find overlapping matches in result
    const overlappingIdx = result.findIndex((existing) => spansOverlap(match, existing));

    if (overlappingIdx === -1) {
      // No overlap, add directly
      result.push(match);
    } else {
      // Has overlap, resolve
      const existing = result[overlappingIdx]!;
      const winner = resolveOverlap(existing, match, policy, config);

      if (winner === match) {
        // New match wins, replace existing
        result[overlappingIdx] = match;
      }
      // Otherwise keep existing (do nothing)
    }
  }

  return result;
}

/**
 * Resolves overlap between two spans
 * Returns the winner
 */
function resolveOverlap(
  a: SpanMatch,
  b: SpanMatch,
  policy: AnonymizationPolicy,
  config: ResolverConfig
): SpanMatch {
  // Rule 1: Regex always beats NER if configured
  if (config.regexPriority) {
    if (a.source === DetectionSource.REGEX && b.source !== DetectionSource.REGEX) {
      return a;
    }
    if (b.source === DetectionSource.REGEX && a.source !== DetectionSource.REGEX) {
      return b;
    }
  }

  // Rule 2: Apply overlap strategy
  switch (config.overlapStrategy) {
    case OverlapStrategy.LONGER_SPAN: {
      const lenA = spanLength(a);
      const lenB = spanLength(b);
      if (lenA !== lenB) {
        return lenA > lenB ? a : b;
      }
      break;
    }

    case OverlapStrategy.HIGHER_CONFIDENCE: {
      if (a.confidence !== b.confidence) {
        return a.confidence > b.confidence ? a : b;
      }
      break;
    }

    case OverlapStrategy.TYPE_PRIORITY: {
      const priorityA = getTypePriority(a.type, policy);
      const priorityB = getTypePriority(b.type, policy);
      if (priorityA !== priorityB) {
        return priorityA > priorityB ? a : b;
      }
      break;
    }

    case OverlapStrategy.REGEX_PRIORITY:
    default:
      // Already handled above
      break;
  }

  // Tiebreakers: longer span > higher confidence > type priority
  const lenA = spanLength(a);
  const lenB = spanLength(b);
  if (lenA !== lenB) {
    return lenA > lenB ? a : b;
  }

  if (a.confidence !== b.confidence) {
    return a.confidence > b.confidence ? a : b;
  }

  const priorityA = getTypePriority(a.type, policy);
  const priorityB = getTypePriority(b.type, policy);
  if (priorityA !== priorityB) {
    return priorityA > priorityB ? a : b;
  }

  // Final tiebreaker: keep first one
  return a;
}

/**
 * Gets type priority from policy (higher = more important)
 */
function getTypePriority(type: PIIType, policy: AnonymizationPolicy): number {
  const priorityList = policy.typePriority.length > 0 ? policy.typePriority : [...DEFAULT_TYPE_PRIORITY];
  const index = priorityList.indexOf(type);
  return index >= 0 ? index : -1;
}

/**
 * Removes exact duplicate spans
 */
function deduplicateExact(matches: SpanMatch[]): SpanMatch[] {
  const seen = new Set<string>();
  const result: SpanMatch[] = [];

  for (const match of matches) {
    const key = `${match.start}:${match.end}:${match.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(match);
    }
  }

  return result;
}

/**
 * Creates protected spans from regex matches
 * Used to mask regex matches from NER to avoid double-detection
 */
export function createProtectedSpans(
  regexMatches: SpanMatch[]
): Array<{ start: number; end: number }> {
  return regexMatches.map(({ start, end }) => ({ start, end }));
}

/**
 * Checks if a span overlaps with any protected span
 */
export function isInProtectedSpan(
  span: { start: number; end: number },
  protectedSpans: Array<{ start: number; end: number }>
): boolean {
  return protectedSpans.some((protected_) => spansOverlap(span, protected_));
}

