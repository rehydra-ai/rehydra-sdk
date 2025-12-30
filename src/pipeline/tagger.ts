/**
 * Replacement Tagger
 * Replaces PII spans with placeholder tags and builds the PII map
 */

import {
  PIIType,
  SpanMatch,
  DetectedEntity,
  AnonymizationPolicy,
  SemanticAttributes,
} from "../types/index.js";
import { sortSpansByPosition } from "../utils/offsets.js";

/**
 * PII Map entry (before encryption)
 */
export interface PIIMapEntry {
  /** PII type */
  type: PIIType;
  /** Entity ID */
  id: number;
  /** Original text */
  original: string;
}

/**
 * Raw PII Map (before encryption)
 */
export type RawPIIMap = Map<string, string>;

/**
 * Tagging result
 */
export interface TaggingResult {
  /** Anonymized text with placeholder tags */
  anonymizedText: string;
  /** List of detected entities with assigned IDs */
  entities: DetectedEntity[];
  /** Raw PII map (type_id -> original) */
  piiMap: RawPIIMap;
}

/**
 * Generates a PII placeholder tag
 * Format: <PII type="TYPE" id="N"/> or <PII type="TYPE" gender="X" id="N"/> etc.
 *
 * Semantic attributes (gender, scope) are included when provided and not 'unknown'
 */
export function generateTag(
  type: PIIType,
  id: number,
  semantic?: SemanticAttributes
): string {
  let attrs = `type="${type}"`;

  // Add semantic attributes if present and meaningful
  if (semantic?.gender && semantic.gender !== "unknown") {
    attrs += ` gender="${semantic.gender}"`;
  }
  if (semantic?.scope && semantic.scope !== "unknown") {
    attrs += ` scope="${semantic.scope}"`;
  }

  attrs += ` id="${id}"`;

  return `<PII ${attrs}/>`;
}

/**
 * Result of parsing a PII tag
 */
export interface ParsedTag {
  type: PIIType;
  id: number;
  semantic?: SemanticAttributes;
}

/**
 * Parses a PII tag to extract type, id, and semantic attributes
 * Returns null if not a valid tag
 *
 * Supports formats:
 * - <PII type="TYPE" id="N"/>
 * - <PII type="TYPE" gender="X" id="N"/>
 * - <PII type="TYPE" scope="X" id="N"/>
 * - <PII type="TYPE" gender="X" scope="Y" id="N"/>
 */
export function parseTag(tag: string): ParsedTag | null {
  // More flexible regex that handles optional gender/scope attributes
  const match = tag.match(
    /^<PII\s+type="([A-Z_]+)"(?:\s+gender="(\w+)")?(?:\s+scope="(\w+)")?\s+id="(\d+)"\s*\/>$/
  );

  if (match === null) {
    return null;
  }

  const [, typeStr, genderStr, scopeStr, idStr] = match;
  if (typeStr === undefined || idStr === undefined) {
    return null;
  }

  const type = typeStr as PIIType;
  const id = parseInt(idStr, 10);

  // Validate type is a valid PIIType
  if (!Object.values(PIIType).includes(type)) {
    return null;
  }

  // Build semantic attributes if present
  let semantic: SemanticAttributes | undefined;
  if (
    (genderStr !== undefined && genderStr !== "") ||
    (scopeStr !== undefined && scopeStr !== "")
  ) {
    semantic = {};
    if (
      genderStr !== undefined &&
      genderStr !== "" &&
      ["male", "female", "neutral", "unknown"].includes(genderStr)
    ) {
      semantic.gender = genderStr as SemanticAttributes["gender"];
    }
    if (
      scopeStr !== undefined &&
      scopeStr !== "" &&
      ["city", "country", "region", "unknown"].includes(scopeStr)
    ) {
      semantic.scope = scopeStr as SemanticAttributes["scope"];
    }
  }

  return { type, id, semantic };
}

/**
 * Creates a key for the PII map
 */
export function createPIIMapKey(type: PIIType, id: number): string {
  return `${type}_${id}`;
}

/**
 * Parses a PII map key to extract type and id
 * @param key - Key in format "TYPE_ID" (e.g., "PERSON_1")
 * @returns Parsed type and id, or null if invalid
 */
function parsePIIMapKey(key: string): { type: PIIType; id: number } | null {
  const match = key.match(/^([A-Z_]+)_(\d+)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const type = match[1] as PIIType;
  const id = parseInt(match[2], 10);
  if (!Object.values(PIIType).includes(type)) {
    return null;
  }
  return { type, id };
}

/**
 * Builds a reverse lookup and max ID from an existing PII map
 * @param existingPiiMap - Existing PII map (key → value)
 * @returns Reverse lookup (type:value → id) and global max ID
 */
function buildExistingEntityLookup(existingPiiMap: RawPIIMap): {
  reverseLookup: Map<string, number>;
  maxId: number;
} {
  const reverseLookup = new Map<string, number>(); // "TYPE:value" → id
  let maxId = 0;

  for (const [key, value] of existingPiiMap) {
    const parsed = parsePIIMapKey(key);
    if (parsed !== null) {
      // Build reverse lookup: "PERSON:Tom" → 1
      const lookupKey = `${parsed.type}:${value}`;
      reverseLookup.set(lookupKey, parsed.id);

      // Track global max ID
      if (parsed.id > maxId) {
        maxId = parsed.id;
      }
    }
  }

  return { reverseLookup, maxId };
}

/**
 * Tags PII spans in text and builds the PII map
 * @param text - Input text to tag
 * @param matches - Detected PII spans
 * @param policy - Anonymization policy
 * @param existingPiiMap - Optional existing PII map for session-level ID reuse
 */
export function tagEntities(
  text: string,
  matches: SpanMatch[],
  policy: AnonymizationPolicy,
  existingPiiMap?: RawPIIMap
): TaggingResult {
  if (matches.length === 0) {
    return {
      anonymizedText: text,
      entities: [],
      piiMap: new Map(),
    };
  }

  // Sort by start position ascending for ID assignment
  const sortedAscending = sortSpansByPosition(matches);

  // Build lookup from existing PII map (if provided)
  const { reverseLookup, maxId } = existingPiiMap
    ? buildExistingEntityLookup(existingPiiMap)
    : { reverseLookup: new Map<string, number>(), maxId: 0 };

  // Assign IDs
  const entitiesWithIds: Array<SpanMatch & { id: number }> = [];

  // Global ID counter (starts from max existing + 1)
  let nextId = maxId + 1;

  // Track seen text for ID reuse within this call (if enabled)
  const seenText = new Map<string, number>(); // "type:text" -> id

  for (const match of sortedAscending) {
    let id: number;
    const lookupKey = `${match.type}:${match.text}`;

    // First, check if this value exists in the existing PII map (session-level reuse)
    const existingId = reverseLookup.get(lookupKey);
    if (existingId !== undefined) {
      id = existingId;
      // Also add to seenText so repeated occurrences in this call use the same ID
      seenText.set(lookupKey, id);
    } else if (policy.reuseIdsForRepeatedPII) {
      // Check if we've seen this value earlier in this call
      const seenId = seenText.get(lookupKey);
      if (seenId !== undefined) {
        id = seenId;
      } else {
        id = nextId++;
        seenText.set(lookupKey, id);
      }
    } else {
      id = nextId++;
    }

    entitiesWithIds.push({ ...match, id });
  }

  // Build PII map
  const piiMap: RawPIIMap = new Map();
  for (const entity of entitiesWithIds) {
    const key = createPIIMapKey(entity.type, entity.id);
    piiMap.set(key, entity.text);
  }

  // Sort by start position descending for replacement
  // (replacing from end to start preserves earlier offsets)
  const sortedDescending = [...entitiesWithIds].sort(
    (a, b) => b.start - a.start
  );

  // Perform replacements
  let anonymizedText = text;
  for (const entity of sortedDescending) {
    const tag = generateTag(entity.type, entity.id, entity.semantic);
    anonymizedText =
      anonymizedText.slice(0, entity.start) +
      tag +
      anonymizedText.slice(entity.end);
  }

  // Build final entities list (sorted by position)
  const entities: DetectedEntity[] = entitiesWithIds.map((e) => ({
    type: e.type,
    id: e.id,
    start: e.start,
    end: e.end,
    confidence: e.confidence,
    source: e.source,
    original: e.text,
    semantic: e.semantic,
  }));

  return {
    anonymizedText,
    entities: sortSpansByPosition(entities),
    piiMap,
  };
}

/**
 * Validates that a tag is well-formed
 */
export function isValidTag(tag: string): boolean {
  return parseTag(tag) !== null;
}

/**
 * Tag extraction result with the matched text for accurate replacement
 */
export interface ExtractedTag {
  type: PIIType;
  id: number;
  position: number;
  /** The actual matched text (needed for replacement when tag is mangled) */
  matchedText: string;
  /** Semantic attributes extracted from the tag */
  semantic?: SemanticAttributes;
}

/**
 * Quote characters that might appear after translation
 * Includes: standard quotes, smart quotes, German quotes, French quotes, etc.
 *
 * Unicode references:
 * - \u0022 (") Standard double quote
 * - \u0027 (') Standard single quote
 * - \u0060 (`) Backtick
 * - \u00AB («) Left guillemet
 * - \u00BB (») Right guillemet
 * - \u2018 (') Left single curly quote
 * - \u2019 (') Right single curly quote
 * - \u201A (‚) Single low-9 quote
 * - \u201C (") Left double curly quote
 * - \u201D (") Right double curly quote
 * - \u201E („) Double low-9 quote (German)
 */
const QUOTE_CHARS = "[\"'`\u00AB\u00BB\u2018\u2019\u201A\u201C\u201D\u201E]";

/**
 * Whitespace pattern including various unicode spaces
 */
const FLEXIBLE_WS = `[\\s\\u00A0\\u2000-\\u200B]*`;
const FLEXIBLE_WS_REQUIRED = `[\\s\\u00A0\\u2000-\\u200B]+`;

/**
 * HTML-encoded bracket patterns
 * Matches both literal brackets and HTML entity encoded versions
 * - Opening: < or &lt;
 * - Closing: > or &gt;
 */
const OPEN_BRACKET = `(?:<|&lt;)`;
const CLOSE_BRACKET = `(?:>|&gt;)`;

/**
 * Builds patterns for fuzzy PII tag matching
 * Handles various translation artifacts and optional semantic attributes
 *
 * Now also handles HTML-encoded tags where < becomes &lt; and > becomes &gt;
 * This commonly happens when LLMs (like ChatGPT) HTML-encode their responses
 */
function buildFuzzyTagPatterns(): RegExp[] {
  // Pattern for type attribute: type = "VALUE" (flexible spacing and quotes)
  const typeAttr = `type${FLEXIBLE_WS}=${FLEXIBLE_WS}${QUOTE_CHARS}([A-Z_]+)${QUOTE_CHARS}`;
  // Pattern for id attribute: id = "VALUE" (flexible spacing and quotes)
  // Also handles malformed cases where /> or /&gt; got placed inside the quotes (e.g., id="7/>")
  const idAttr = `id${FLEXIBLE_WS}=${FLEXIBLE_WS}${QUOTE_CHARS}(\\d+)(?:\\/?(?:>|&gt;)?)?${QUOTE_CHARS}`;
  // Optional gender attribute
  const genderAttr = `(?:${FLEXIBLE_WS}gender${FLEXIBLE_WS}=${FLEXIBLE_WS}${QUOTE_CHARS}(\\w+)${QUOTE_CHARS})?`;
  // Optional scope attribute
  const scopeAttr = `(?:${FLEXIBLE_WS}scope${FLEXIBLE_WS}=${FLEXIBLE_WS}${QUOTE_CHARS}(\\w+)${QUOTE_CHARS})?`;

  // Self-closing tag endings: />, / >, >, /&gt;, &gt;, or nothing if already closed inside quotes
  const selfClosing = `${FLEXIBLE_WS}\\/?${FLEXIBLE_WS}${CLOSE_BRACKET}?`;

  return [
    // type first with optional gender/scope: <PII type="X" gender="Y" scope="Z" id="N"/>
    // Also matches: &lt;PII type="X" gender="Y" scope="Z" id="N"/&gt;
    // Groups: type=1, gender=2, scope=3, id=4
    new RegExp(
      `${OPEN_BRACKET}${FLEXIBLE_WS}PII${FLEXIBLE_WS_REQUIRED}${typeAttr}${genderAttr}${scopeAttr}${FLEXIBLE_WS_REQUIRED}${idAttr}${selfClosing}`,
      "gi"
    ),
    // id first: <PII id="N" type="X"/>
    // Also matches: &lt;PII id="N" type="X"/&gt;
    // Groups: id=1, type=2
    new RegExp(
      `${OPEN_BRACKET}${FLEXIBLE_WS}PII${FLEXIBLE_WS_REQUIRED}${idAttr}${FLEXIBLE_WS_REQUIRED}${typeAttr}${selfClosing}`,
      "gi"
    ),
  ];
}

/**
 * Extracts all PII tags from anonymized text using fuzzy matching
 * Handles mangled tags that may occur after translation
 *
 * Translation can mangle tags by:
 * - Changing quote types (" → " or „ or « etc.)
 * - Adding/removing whitespace
 * - Changing case (type → Type, PII → pii)
 * - Reordering attributes (id before type)
 * - Modifying self-closing syntax (/> → / > or >)
 */
export function extractTags(anonymizedText: string): ExtractedTag[] {
  const tags: ExtractedTag[] = [];
  const patterns = buildFuzzyTagPatterns();

  // Track positions we've already matched to avoid duplicates from overlapping patterns
  const matchedPositions = new Set<number>();

  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    if (pattern === undefined) continue;

    let match: RegExpExecArray | null;
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;

    while ((match = pattern.exec(anonymizedText)) !== null) {
      if (matchedPositions.has(match.index)) {
        continue; // Skip duplicates from overlapping patterns
      }

      // Extract type, id, and semantic attributes based on which pattern matched
      // Pattern 0: type first with optional gender/scope (groups: type=1, gender=2, scope=3, id=4)
      // Pattern 1: id first (groups: id=1, type=2)
      let typeStr: string | undefined;
      let idStr: string | undefined;
      let genderStr: string | undefined;
      let scopeStr: string | undefined;

      if (patternIndex === 0) {
        typeStr = match[1];
        genderStr = match[2];
        scopeStr = match[3];
        idStr = match[4];
      } else {
        idStr = match[1];
        typeStr = match[2];
      }

      if (typeStr !== undefined && idStr !== undefined) {
        const type = typeStr.toUpperCase() as PIIType;
        const id = parseInt(idStr, 10);

        if (Object.values(PIIType).includes(type)) {
          // Build semantic attributes if present
          let semantic: SemanticAttributes | undefined;
          if (
            (genderStr !== undefined && genderStr !== "") ||
            (scopeStr !== undefined && scopeStr !== "")
          ) {
            semantic = {};
            if (
              genderStr !== undefined &&
              genderStr !== "" &&
              ["male", "female", "neutral", "unknown"].includes(
                genderStr.toLowerCase()
              )
            ) {
              semantic.gender =
                genderStr.toLowerCase() as SemanticAttributes["gender"];
            }
            if (
              scopeStr !== undefined &&
              scopeStr !== "" &&
              ["city", "country", "region", "unknown"].includes(
                scopeStr.toLowerCase()
              )
            ) {
              semantic.scope =
                scopeStr.toLowerCase() as SemanticAttributes["scope"];
            }
          }

          tags.push({
            type,
            id,
            position: match.index,
            matchedText: match[0],
            semantic,
          });
          matchedPositions.add(match.index);
        }
      }
    }
  }

  // Sort by position ascending
  tags.sort((a, b) => a.position - b.position);

  return tags;
}

/**
 * Extracts tags using strict matching (original behavior)
 * Useful when you know tags haven't been mangled
 * Supports optional gender and scope attributes
 */
export function extractTagsStrict(anonymizedText: string): ExtractedTag[] {
  const tags: ExtractedTag[] = [];
  // Pattern matches: <PII type="X" [gender="Y"] [scope="Z"] id="N"/>
  const tagPattern =
    /<PII\s+type="([A-Z_]+)"(?:\s+gender="(\w+)")?(?:\s+scope="(\w+)")?\s+id="(\d+)"\s*\/>/g;

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(anonymizedText)) !== null) {
    const typeStr = match[1];
    const genderStr = match[2];
    const scopeStr = match[3];
    const idStr = match[4];

    if (typeStr !== undefined && idStr !== undefined) {
      const type = typeStr as PIIType;
      const id = parseInt(idStr, 10);

      if (Object.values(PIIType).includes(type)) {
        // Build semantic attributes if present
        let semantic: SemanticAttributes | undefined;
        if (
          (genderStr !== undefined && genderStr !== "") ||
          (scopeStr !== undefined && scopeStr !== "")
        ) {
          semantic = {};
          if (
            genderStr !== undefined &&
            genderStr !== "" &&
            ["male", "female", "neutral", "unknown"].includes(genderStr)
          ) {
            semantic.gender = genderStr as SemanticAttributes["gender"];
          }
          if (
            scopeStr !== undefined &&
            scopeStr !== "" &&
            ["city", "country", "region", "unknown"].includes(scopeStr)
          ) {
            semantic.scope = scopeStr as SemanticAttributes["scope"];
          }
        }

        tags.push({
          type,
          id,
          position: match.index,
          matchedText: match[0],
          semantic,
        });
      }
    }
  }

  return tags;
}

/**
 * Counts entities by type
 */
export function countEntitiesByType(
  entities: DetectedEntity[]
): Record<PIIType, number> {
  const counts: Record<PIIType, number> = {} as Record<PIIType, number>;

  // Initialize all types to 0
  for (const type of Object.values(PIIType)) {
    counts[type] = 0;
  }

  // Count entities
  for (const entity of entities) {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  }

  return counts;
}

/**
 * Rehydrates anonymized text using the PII map
 * Uses fuzzy matching to handle tags that may have been mangled by translation
 *
 * @param anonymizedText - Text containing PII tags (possibly mangled)
 * @param piiMap - Map of PII keys to original values
 * @param strict - If true, use strict matching (original behavior). Default: false
 * @returns Text with PII tags replaced by original values
 */
export function rehydrate(
  anonymizedText: string,
  piiMap: RawPIIMap,
  strict: boolean = false
): string {
  let result = anonymizedText;
  const tags = strict
    ? extractTagsStrict(anonymizedText)
    : extractTags(anonymizedText);

  // Sort by position descending for replacement
  // (replacing from end to start preserves earlier offsets)
  tags.sort((a, b) => b.position - a.position);

  for (const { type, id, position, matchedText } of tags) {
    const key = createPIIMapKey(type, id);
    const original = piiMap.get(key);

    if (original !== undefined) {
      // Use the actual matched text length for replacement
      // This handles mangled tags where the length differs from the canonical form
      result =
        result.slice(0, position) +
        original +
        result.slice(position + matchedText.length);
    }
  }

  return result;
}
