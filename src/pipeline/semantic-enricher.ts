/**
 * Semantic Enricher
 * Enriches PII spans with semantic attributes (gender, location scope)
 * for MT-friendly tags that preserve grammatical context.
 * 
 * This module uses data from the GeoNames and gender-guesser projects.
 * Data is automatically downloaded when using:
 *   createAnonymizer({ semantic: { enabled: true, autoDownload: true } })
 */

import {
  SpanMatch,
  PIIType,
  PersonGender,
  LocationScope,
  SemanticAttributes,
} from '../types/index.js';

import {
  isSemanticDataAvailable,
  loadSemanticData,
  lookupGender,
  lookupLocationType,
  getDataStats,
  getDataDirectory,
} from './semantic-data-loader.js';

// Re-export data availability check and other exports from data loader
export { isSemanticDataAvailable, getDataDirectory };

/**
 * Configuration for semantic enrichment
 */
export interface EnricherConfig {
  /** Locale hint for name gender disambiguation (e.g., 'de', 'it', 'fr') */
  locale?: string;
  /** Minimum confidence to apply semantic attributes (default: 0.0) */
  minConfidence?: number;
  /** Whether to mark low-confidence results as 'unknown' */
  strictMode?: boolean;
}

/**
 * Result of gender inference with confidence
 */
export interface GenderResult {
  gender: PersonGender;
  confidence: number;
  source: 'database' | 'inference' | 'unknown';
}

/**
 * Result of location classification with confidence
 */
export interface LocationResult {
  scope: LocationScope;
  confidence: number;
  countryCode?: string;
}

// Track if data has been initialized
let dataInitialized = false;

/**
 * Ensures semantic data is loaded synchronously (assumes files are already downloaded)
 * @throws Error if data files are not available
 */
function ensureDataLoaded(): void {
  if (dataInitialized) return;
  
  if (!isSemanticDataAvailable()) {
    throw new Error(
      `Semantic enrichment data not available. ` +
      `Use ensureSemanticData() or createAnonymizer({ semantic: { enabled: true } }) to download.`
    );
  }
  
  loadSemanticData();
  dataInitialized = true;
}

/**
 * Enriches PII spans with semantic attributes based on lookup tables
 * 
 * @param spans - Array of detected PII spans
 * @param config - Optional configuration for enrichment
 * @returns Array of spans with semantic attributes added
 * 
 * @example
 * ```typescript
 * const enrichedSpans = enrichSemantics(spans, { locale: 'de' });
 * // "Mary" -> { gender: 'female' }
 * // "Berlin" -> { scope: 'city' }
 * ```
 */
export function enrichSemantics(
  spans: SpanMatch[],
  config?: EnricherConfig
): SpanMatch[] {
  // Ensure data is loaded
  if (!dataInitialized) {
    if (!isSemanticDataAvailable()) {
      // Silently skip enrichment if data not available
      return spans;
    }
    ensureDataLoaded();
  }
  
  return spans.map((span) => {
    switch (span.type) {
      case PIIType.PERSON:
        return enrichPerson(span, config?.locale);
      case PIIType.LOCATION:
        return enrichLocation(span);
      default:
        return span;
    }
  });
}

/**
 * Enriches a PERSON span with gender attribute
 */
function enrichPerson(span: SpanMatch, locale?: string): SpanMatch {
  const result = inferGender(span.text, locale);
  
  return {
    ...span,
    semantic: {
      ...span.semantic,
      gender: result.gender,
    },
  };
}

/**
 * Enriches a LOCATION span with scope attribute
 */
function enrichLocation(span: SpanMatch): SpanMatch {
  const result = classifyLocation(span.text);
  
  return {
    ...span,
    semantic: {
      ...span.semantic,
      scope: result.scope,
    },
  };
}

/**
 * Infers gender from a person's name using the lookup database
 * 
 * @param name - Full name or first name
 * @param locale - Optional locale for disambiguation (e.g., 'de', 'it')
 * @returns Gender result with confidence
 * 
 * @example
 * ```typescript
 * inferGender('Mary Smith'); // { gender: 'female', confidence: 1.0 }
 * inferGender('Andrea', 'it'); // { gender: 'male', confidence: 1.0 }
 * inferGender('Andrea', 'en'); // { gender: 'female', confidence: 1.0 }
 * ```
 */
export function inferGender(name: string, locale?: string): GenderResult {
  // Extract first name (handles "John Smith" -> "John")
  const firstName = extractFirstName(name);
  if (!firstName) {
    return { gender: 'unknown', confidence: 0, source: 'unknown' };
  }
  
  // Check if data is available
  if (!dataInitialized && !isSemanticDataAvailable()) {
    return { gender: 'unknown', confidence: 0, source: 'unknown' };
  }
  
  if (!dataInitialized) {
    ensureDataLoaded();
  }
  
  const gender = lookupGender(firstName, locale);
  
  if (!gender) {
    return { gender: 'unknown', confidence: 0, source: 'unknown' };
  }
  
  return {
    gender: gender as PersonGender,
    confidence: 1.0,
    source: 'database',
  };
}

/**
 * Classifies a location by its geographic scope
 * 
 * @param location - Location name
 * @returns Classification result with confidence
 * 
 * @example
 * ```typescript
 * classifyLocation('Berlin'); // { scope: 'city', confidence: 1.0 }
 * classifyLocation('Germany'); // { scope: 'country', confidence: 1.0 }
 * classifyLocation('Bavaria'); // { scope: 'region', confidence: 1.0 }
 * ```
 */
export function classifyLocation(location: string): LocationResult {
  // Check if data is available
  if (!dataInitialized && !isSemanticDataAvailable()) {
    return { scope: 'unknown', confidence: 0 };
  }
  
  if (!dataInitialized) {
    ensureDataLoaded();
  }
  
  const normalized = normalizeLocationName(location);
  const result = lookupLocationType(normalized);
  
  if (!result) {
    // Try variations
    const variations = generateLocationVariations(location);
    for (const variant of variations) {
      const variantResult = lookupLocationType(variant);
      if (variantResult) {
        return {
          scope: variantResult.type as LocationScope,
          confidence: 0.9,
          countryCode: variantResult.countryCode,
        };
      }
    }
    
    return { scope: 'unknown', confidence: 0 };
  }
  
  return {
    scope: result.type as LocationScope,
    confidence: 1.0,
    countryCode: result.countryCode,
  };
}

/**
 * Extracts the first name from a full name
 */
function extractFirstName(fullName: string): string | null {
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  
  // Handle common prefixes (Dr., Mr., Mrs., etc.)
  const withoutPrefix = trimmed.replace(
    /^(dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|rev\.?|sir|dame|lord|lady)\s+/i,
    ''
  );
  
  // Split and get first word
  const parts = withoutPrefix.split(/\s+/);
  return parts[0] ?? null;
}

/**
 * Normalizes a location name for lookup
 */
function normalizeLocationName(location: string): string {
  return location
    .toLowerCase()
    .trim()
    // Remove common suffixes
    .replace(/\s+(city|town|village|state|province|region|county)$/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ');
}

/**
 * Generates variations of a location name for fuzzy matching
 */
function generateLocationVariations(location: string): string[] {
  const normalized = normalizeLocationName(location);
  const variations: string[] = [];
  
  // Try without "the"
  if (normalized.startsWith('the ')) {
    variations.push(normalized.slice(4));
  }
  
  // Try without common articles in other languages
  const articlePatterns = [
    /^(la|le|les|el|los|las|il|lo|gli|i|die|der|das|de|het)\s+/i,
  ];
  for (const pattern of articlePatterns) {
    const withoutArticle = normalized.replace(pattern, '');
    if (withoutArticle !== normalized) {
      variations.push(withoutArticle);
    }
  }
  
  // Try ASCII transliteration for common diacritics
  const asciiVersion = normalized
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[ß]/g, 'ss')
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[œ]/g, 'oe');
  
  if (asciiVersion !== normalized) {
    variations.push(asciiVersion);
  }
  
  return variations;
}

/**
 * Gets statistics about the lookup databases
 */
export function getDatabaseStats(): {
  names: number;
  cities: number;
  countries: number;
  regions: number;
  loaded: boolean;
} {
  return getDataStats();
}

/**
 * Checks if a name exists in the database
 */
export function hasName(name: string): boolean {
  if (!dataInitialized && !isSemanticDataAvailable()) {
    return false;
  }
  
  if (!dataInitialized) {
    ensureDataLoaded();
  }
  
  const firstName = extractFirstName(name);
  if (!firstName) return false;
  
  return lookupGender(firstName) !== undefined;
}

/**
 * Checks if a location exists in the database
 */
export function hasLocation(location: string): boolean {
  if (!dataInitialized && !isSemanticDataAvailable()) {
    return false;
  }
  
  if (!dataInitialized) {
    ensureDataLoaded();
  }
  
  const normalized = normalizeLocationName(location);
  return lookupLocationType(normalized) !== undefined;
}
