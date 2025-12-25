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
} from "../types/index.js";

import {
  isSemanticDataDownloaded,
  loadSemanticData,
  getSemanticDataSync,
  getDataStats,
} from "./semantic-data-loader.js";

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
  source: "database" | "inference" | "unknown";
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
 * Initializes semantic data (async, must be called before sync functions)
 * @throws Error if data files are not available
 */
export async function initializeEnricher(): Promise<void> {
  if (dataInitialized) return;

  const available = await isSemanticDataDownloaded();
  if (!available) {
    throw new Error(
      `Semantic enrichment data not available. ` +
        `Use ensureSemanticData() or createAnonymizer({ semantic: { enabled: true } }) to download.`
    );
  }

  await loadSemanticData();
  dataInitialized = true;
}

/**
 * Checks if enricher is ready for synchronous operations
 */
export function isEnricherReady(): boolean {
  return dataInitialized && getSemanticDataSync() !== null;
}

/**
 * Enriches PII spans with semantic attributes based on lookup tables
 *
 * NOTE: This function requires semantic data to be pre-loaded via initializeEnricher()
 * or through createAnonymizer({ semantic: { enabled: true } }).
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
  // Check if data is loaded
  const data = getSemanticDataSync();
  if (data === null) {
    // Silently skip enrichment if data not available
    return spans;
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
 * Looks up gender for a name in the database (synchronous)
 */
function lookupGenderSync(
  name: string,
  locale?: string
): string | undefined {
  const data = getSemanticDataSync();
  if (data === null) return undefined;

  const entry = data.names.get(name.toLowerCase());
  if (entry === undefined) return undefined;

  // Check for locale-specific override
  if (
    locale !== undefined &&
    locale !== "" &&
    entry.localeOverrides !== undefined &&
    entry.localeOverrides[locale] !== undefined
  ) {
    return entry.localeOverrides[locale];
  }

  return entry.gender;
}

/**
 * Population threshold for "major" cities that take precedence over regions
 */
const MAJOR_CITY_POPULATION = 500000;

/**
 * Looks up location type synchronously
 */
function lookupLocationTypeSync(
  location: string
): { type: "city" | "country" | "region"; countryCode?: string } | undefined {
  const data = getSemanticDataSync();
  if (data === null) return undefined;

  const normalized = location.toLowerCase().trim();

  // Check countries FIRST (to avoid "USA" being matched as a city)
  const countryCode = data.countries.get(normalized);
  if (countryCode !== undefined) {
    return { type: "country", countryCode };
  }

  // Check cities - if it's a major city (pop > 500K), prioritize it over regions
  const city = data.cities.get(normalized);
  if (city && city.population >= MAJOR_CITY_POPULATION) {
    return { type: "city", countryCode: city.country };
  }

  // Check regions
  const region = data.regions.get(normalized);
  if (region) {
    return { type: "region", countryCode: region.country };
  }

  // Check remaining cities (smaller cities)
  if (city) {
    return { type: "city", countryCode: city.country };
  }

  return undefined;
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
  if (firstName === null || firstName === "") {
    return { gender: "unknown", confidence: 0, source: "unknown" };
  }

  // Check if data is available
  const data = getSemanticDataSync();
  if (data === null) {
    return { gender: "unknown", confidence: 0, source: "unknown" };
  }

  const gender = lookupGenderSync(firstName, locale);

  if (gender === undefined || gender === "") {
    return { gender: "unknown", confidence: 0, source: "unknown" };
  }

  return {
    gender: gender as PersonGender,
    confidence: 1.0,
    source: "database",
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
  const data = getSemanticDataSync();
  if (data === null) {
    return { scope: "unknown", confidence: 0 };
  }

  const normalized = normalizeLocationName(location);
  const result = lookupLocationTypeSync(normalized);

  if (!result) {
    // Try variations
    const variations = generateLocationVariations(location);
    for (const variant of variations) {
      const variantResult = lookupLocationTypeSync(variant);
      if (variantResult) {
        return {
          scope: variantResult.type as LocationScope,
          confidence: 0.9,
          countryCode: variantResult.countryCode,
        };
      }
    }

    return { scope: "unknown", confidence: 0 };
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
    ""
  );

  // Split and get first word
  const parts = withoutPrefix.split(/\s+/);
  return parts[0] ?? null;
}

/**
 * Normalizes a location name for lookup
 */
function normalizeLocationName(location: string): string {
  return (
    location
      .toLowerCase()
      .trim()
      // Remove common suffixes
      .replace(/\s+(city|town|village|state|province|region|county)$/i, "")
      // Normalize whitespace
      .replace(/\s+/g, " ")
  );
}

/**
 * Generates variations of a location name for fuzzy matching
 */
function generateLocationVariations(location: string): string[] {
  const normalized = normalizeLocationName(location);
  const variations: string[] = [];

  // Try without "the"
  if (normalized.startsWith("the ")) {
    variations.push(normalized.slice(4));
  }

  // Try without common articles in other languages
  const articlePatterns = [
    /^(la|le|les|el|los|las|il|lo|gli|i|die|der|das|de|het)\s+/i,
  ];
  for (const pattern of articlePatterns) {
    const withoutArticle = normalized.replace(pattern, "");
    if (withoutArticle !== normalized) {
      variations.push(withoutArticle);
    }
  }

  // Try ASCII transliteration for common diacritics
  const asciiVersion = normalized
    .replace(/[àáâãäå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ñ]/g, "n")
    .replace(/[ç]/g, "c")
    .replace(/[ß]/g, "ss")
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[œ]/g, "oe");

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
  const data = getSemanticDataSync();
  if (data === null) {
    return false;
  }

  const firstName = extractFirstName(name);
  if (firstName === null || firstName === "") return false;

  return lookupGenderSync(firstName) !== undefined;
}

/**
 * Checks if a location exists in the database
 */
export function hasLocation(location: string): boolean {
  const data = getSemanticDataSync();
  if (data === null) {
    return false;
  }

  const normalized = normalizeLocationName(location);
  return lookupLocationTypeSync(normalized) !== undefined;
}
