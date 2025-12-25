/**
 * Semantic Data Loader
 * Handles automatic downloading, caching, and parsing of semantic enrichment data.
 * Browser-compatible using storage abstraction layer
 *
 * Data sources:
 * - nam_dict.txt: Name-gender mappings from gender-guesser (~40K names)
 * - cities15000.txt: GeoNames cities with population > 15,000 (~25K cities)
 * - countryInfo.txt: Country names and codes (~250 countries)
 * - admin1CodesASCII.txt: First-level admin divisions (~4K regions)
 *
 * Data is cached using the storage abstraction layer:
 * - Node.js: Platform-specific cache directories
 * - Browser: IndexedDB
 */

import { getStorageProvider, type StorageProvider } from "../utils/storage.js";
import { join, basename } from "../utils/path.js";

/**
 * Gender code mappings from nam_dict.txt format
 */
const GENDER_CODE_MAP: Record<string, string> = {
  M: "male",
  "1M": "male",
  "?M": "male", // mostly male
  F: "female",
  "1F": "female",
  "?F": "female", // mostly female
  "?": "neutral", // unisex
};

/**
 * Country column positions in nam_dict.txt (0-indexed from column 30)
 * These correspond to the frequency values for each country
 */
const COUNTRY_COLUMNS: Record<string, number> = {
  gb: 0, // Great Britain
  ie: 1, // Ireland
  us: 2, // USA
  it: 3, // Italy
  mt: 4, // Malta
  pt: 5, // Portugal
  es: 6, // Spain
  fr: 7, // France
  be: 8, // Belgium
  lu: 9, // Luxembourg
  nl: 10, // Netherlands
  de: 11, // Germany (East Frisia at 10, Germany at 11)
  at: 12, // Austria
  ch: 13, // Swiss
  is: 14, // Iceland
  dk: 15, // Denmark
  no: 16, // Norway
  se: 17, // Sweden
  fi: 18, // Finland
  ee: 19, // Estonia
  lv: 20, // Latvia
  lt: 21, // Lithuania
  pl: 22, // Poland
  cz: 23, // Czech Republic
  sk: 24, // Slovakia
  hu: 25, // Hungary
  ro: 26, // Romania
  bg: 27, // Bulgaria
  hr: 28, // Croatia (Bosnian)
  si: 29, // Slovenia
  rs: 30, // Serbia (Albanian)
  mk: 31, // Macedonia
  gr: 32, // Greece
  ru: 33, // Russia
  by: 34, // Belarus
  md: 35, // Moldova
  ua: 36, // Ukraine
  am: 37, // Armenia
  az: 38, // Azerbaijan
  ge: 39, // Georgia
  kz: 40, // Kazakhstan/Uzbekistan
  tr: 41, // Turkey
  sa: 42, // Arabia/Persia
  il: 43, // Israel
  cn: 44, // China
  in: 45, // India/Sri Lanka
  jp: 46, // Japan
  kr: 47, // Korea
  vn: 48, // Vietnam
};

// Keep COUNTRY_COLUMNS for future locale-specific gender lookups
void COUNTRY_COLUMNS;

/**
 * Loaded name-gender data
 */
interface NameEntry {
  gender: string;
  localeOverrides?: Record<string, string>;
}

/**
 * Loaded location data
 */
interface CityEntry {
  country: string;
  population: number;
}

interface RegionEntry {
  country: string;
  name: string;
}

/**
 * Semantic data store
 */
interface SemanticData {
  names: Map<string, NameEntry>;
  cities: Map<string, CityEntry>;
  countries: Map<string, string>; // name -> code
  regions: Map<string, RegionEntry>;
  loaded: boolean;
}

// Global data store (lazily loaded)
let semanticData: SemanticData | null = null;

// Cached storage provider
let storageProvider: StorageProvider | null = null;

/**
 * Gets the storage provider (lazily initialized)
 */
async function getStorage(): Promise<StorageProvider> {
  if (storageProvider === null) {
    storageProvider = await getStorageProvider();
  }
  return storageProvider;
}

// =============================================================================
// Cache Directory Management
// =============================================================================

/**
 * Gets the cache directory for semantic data
 * Uses platform-specific cache location (or virtual path in browser)
 */
export async function getSemanticDataCacheDir(): Promise<string> {
  const storage = await getStorage();
  return storage.getCacheDir("semantic-data");
}

/**
 * Gets the path to the data directory (alias for backwards compatibility)
 */
export async function getDataDirectory(): Promise<string> {
  return getSemanticDataCacheDir();
}

// =============================================================================
// Data File Registry
// =============================================================================

/**
 * Semantic data file info
 */
export interface SemanticDataFileInfo {
  /** Filename */
  filename: string;
  /** Download URL */
  url: string;
  /** Whether file is required */
  required: boolean;
  /** Description */
  description: string;
  /** Approximate size */
  size: string;
}

/**
 * Base URL for semantic data files hosted on Hugging Face
 */
const HUGGINGFACE_BASE_URL =
  "https://huggingface.co/datasets/tjruesch/bridge-anonymization-semantic/resolve/main";

/**
 * Registry of semantic data files and their download URLs
 */
export const SEMANTIC_DATA_FILES: SemanticDataFileInfo[] = [
  {
    filename: "nam_dict.txt",
    url: `${HUGGINGFACE_BASE_URL}/nam_dict.txt`,
    required: true,
    description: "Name-gender mappings (~40K names)",
    size: "~4.3 MB",
  },
  {
    filename: "cities15000.txt",
    url: `${HUGGINGFACE_BASE_URL}/cities15000.txt`,
    required: true,
    description: "GeoNames cities with population > 15,000",
    size: "~7.8 MB",
  },
  {
    filename: "countryInfo.txt",
    url: `${HUGGINGFACE_BASE_URL}/countryInfo.txt`,
    required: true,
    description: "Country names and codes",
    size: "~31 KB",
  },
  {
    filename: "admin1CodesASCII.txt",
    url: `${HUGGINGFACE_BASE_URL}/admin1CodesASCII.txt`,
    required: false,
    description: "First-level admin divisions (states/regions)",
    size: "~146 KB",
  },
];

// =============================================================================
// Download Functions
// =============================================================================

/**
 * Progress callback for downloads
 */
export type SemanticDownloadProgressCallback = (progress: {
  file: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number | null;
}) => void;

/**
 * Checks if semantic data is already downloaded
 */
export async function isSemanticDataDownloaded(): Promise<boolean> {
  const storage = await getStorage();
  const dataDir = await getSemanticDataCacheDir();

  try {
    // Check all required files
    for (const file of SEMANTIC_DATA_FILES) {
      if (file.required) {
        const exists = await storage.exists(join(dataDir, file.filename));
        if (!exists) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the semantic data files are available
 * Note: This is now async to work with browser storage
 */
export async function isSemanticDataAvailable(): Promise<boolean> {
  return isSemanticDataDownloaded();
}

/**
 * Downloads a file from URL and returns the data
 */
async function downloadFileData(
  url: string,
  fileName: string,
  onProgress?: SemanticDownloadProgressCallback
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "bridge-anonymization/1.0.0",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found: ${url}`);
    }
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`
    );
  }

  const totalBytes = response.headers.get("content-length");
  const total =
    totalBytes !== null && totalBytes !== "" ? parseInt(totalBytes, 10) : null;

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("Response body is not readable");
  }

  const chunks: Uint8Array[] = [];
  let bytesDownloaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await reader.read();

    if (result.done) break;

    const value = result.value as Uint8Array;
    chunks.push(value);
    bytesDownloaded += value.length;

    if (onProgress) {
      onProgress({
        file: fileName,
        bytesDownloaded,
        totalBytes: total,
        percent:
          total !== null && total > 0
            ? Math.round((bytesDownloaded / total) * 100)
            : null,
      });
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Downloads a file from URL to storage
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: SemanticDownloadProgressCallback
): Promise<void> {
  const storage = await getStorage();
  const fileName = basename(destPath);

  const data = await downloadFileData(url, fileName, onProgress);
  await storage.writeFile(destPath, data);
}

/**
 * Downloads all semantic data files
 */
export async function downloadSemanticData(
  onProgress?: SemanticDownloadProgressCallback,
  onStatus?: (status: string) => void
): Promise<string> {
  const storage = await getStorage();
  const dataDir = await getSemanticDataCacheDir();

  // Create directory
  await storage.mkdir(dataDir);

  onStatus?.("Downloading semantic enrichment data...");
  onStatus?.(`Cache directory: ${dataDir}`);

  for (const file of SEMANTIC_DATA_FILES) {
    const destPath = join(dataDir, file.filename);

    onStatus?.(`Downloading ${file.description}...`);

    try {
      await downloadFile(file.url, destPath, onProgress);
    } catch (e) {
      if (file.required) {
        throw new Error(
          `Failed to download required file ${file.filename}: ${String(e)}`
        );
      }
      // Optional files can fail silently
      onStatus?.(`Skipping optional file ${file.filename}`);
    }
  }

  onStatus?.("Semantic data download complete!");

  return dataDir;
}

/**
 * Ensures semantic data is available, downloading if needed
 */
export async function ensureSemanticData(
  options: {
    autoDownload?: boolean;
    onProgress?: SemanticDownloadProgressCallback;
    onStatus?: (status: string) => void;
  } = {}
): Promise<string> {
  const { autoDownload = true, onProgress, onStatus } = options;

  const dataDir = await getSemanticDataCacheDir();

  // Check if already downloaded
  const isDownloaded = await isSemanticDataDownloaded();

  if (!isDownloaded) {
    if (!autoDownload) {
      throw new Error(
        `Semantic data not found at ${dataDir}.\n\n` +
          `To download automatically, use:\n` +
          `  createAnonymizer({ semantic: { enabled: true, autoDownload: true } })\n\n` +
          `Or disable semantic masking:\n` +
          `  createAnonymizer({ semantic: { enabled: false } })`
      );
    }

    await downloadSemanticData(onProgress, onStatus);
  } else {
    onStatus?.(`Using cached semantic data: ${dataDir}`);
  }

  return dataDir;
}

/**
 * Clears cached semantic data
 */
export async function clearSemanticDataCache(): Promise<void> {
  const storage = await getStorage();
  const dataDir = await getSemanticDataCacheDir();
  await storage.rm(dataDir, { recursive: true, force: true });
  // Also clear in-memory data
  clearSemanticData();
}

/**
 * Gets info about semantic data files
 */
export async function getSemanticDataInfo(): Promise<{
  files: SemanticDataFileInfo[];
  cacheDir: string;
  totalSize: string;
}> {
  const cacheDir = await getSemanticDataCacheDir();
  return {
    files: SEMANTIC_DATA_FILES,
    cacheDir,
    totalSize: "~4 MB",
  };
}

// =============================================================================
// Data Parsing Functions
// =============================================================================

/**
 * Parses nam_dict.txt content and extracts name-gender mappings
 */
function parseNameDictContent(content: string): Map<string, NameEntry> {
  const names = new Map<string, NameEntry>();
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line.trim() === "") continue;

    // Skip lines with '+' in column 30 (expanded umlauts duplicates)
    if (line.length > 29 && line[29] === "+") continue;

    // Parse gender code and name
    // Format: <gender_code> <name> <spaces> <frequencies>
    const match = line.match(/^(\?[MF]?|1[MF]|[MF])\s+(\S+)/);
    if (!match) continue;

    const [, genderCode, name] = match;
    if (
      genderCode === undefined ||
      genderCode === "" ||
      name === undefined ||
      name === ""
    )
      continue;

    const gender = GENDER_CODE_MAP[genderCode];
    if (gender === undefined) continue;

    const normalizedName = name.toLowerCase();

    // Check for locale-specific gender by looking at frequency columns
    // If a name has frequency in certain countries but different gender elsewhere,
    // we store locale overrides
    const localeOverrides: Record<string, string> = {};

    // For simplicity, we'll detect common locale-specific patterns
    // The full implementation would parse frequency columns

    // Store the entry
    if (!names.has(normalizedName)) {
      names.set(normalizedName, {
        gender,
        localeOverrides:
          Object.keys(localeOverrides).length > 0 ? localeOverrides : undefined,
      });
    } else {
      // If we see a name again with different gender, mark as locale-specific or neutral
      const existing = names.get(normalizedName)!;
      if (existing.gender !== gender) {
        // Create locale overrides for the different gender
        if (!existing.localeOverrides) {
          existing.localeOverrides = {};
        }
        // This is a simplification - full implementation would use frequency data
      }
    }
  }

  return names;
}

/**
 * Parses cities15000.txt content and extracts city data
 * When multiple cities have the same name, keeps the one with highest population
 */
function parseCitiesContent(content: string): Map<string, CityEntry> {
  const cities = new Map<string, CityEntry>();
  const lines = content.split("\n");

  // Helper to add city only if population is higher than existing
  const addCity = (name: string, entry: CityEntry): void => {
    const normalized = name.toLowerCase();
    const existing = cities.get(normalized);
    if (!existing || entry.population > existing.population) {
      cities.set(normalized, entry);
    }
  };

  for (const line of lines) {
    if (line.trim() === "") continue;

    const parts = line.split("\t");
    if (parts.length < 15) continue;

    const name = parts[1];
    const asciiName = parts[2];
    const alternateNames = parts[3]?.split(",") ?? [];
    const countryCode = parts[8];
    const population = parseInt(parts[14] ?? "0", 10);

    if (
      name === undefined ||
      name === "" ||
      countryCode === undefined ||
      countryCode === ""
    )
      continue;

    const cityEntry: CityEntry = { country: countryCode, population };

    // Add main name (prefer higher population)
    addCity(name, cityEntry);

    // Add ASCII name if different (prefer higher population)
    if (
      asciiName !== undefined &&
      asciiName !== "" &&
      asciiName.toLowerCase() !== name.toLowerCase()
    ) {
      addCity(asciiName, cityEntry);
    }

    // Add alternate names (prefer higher population)
    for (const altName of alternateNames) {
      const trimmed = altName.trim();
      if (trimmed && trimmed.length > 2 && !trimmed.includes(",")) {
        addCity(trimmed, cityEntry);
      }
    }
  }

  return cities;
}

/**
 * Generates common country name variations
 */
function getCountryVariations(name: string, code: string): string[] {
  const variations: string[] = [code.toLowerCase()];

  // Common abbreviations and variants
  const variantMap: Record<string, string[]> = {
    "United States": ["USA", "US", "America", "United States of America"],
    "United Kingdom": ["UK", "Britain", "Great Britain", "England"],
    Germany: ["Deutschland"],
    France: ["Frankreich"],
    Spain: ["España", "Espana", "Spanien"],
    Italy: ["Italia", "Italien"],
    Netherlands: ["Holland", "The Netherlands", "Niederlande"],
    Switzerland: ["Schweiz", "Suisse", "Svizzera"],
    Austria: ["Österreich", "Oesterreich"],
    Belgium: ["Belgien", "Belgique"],
    Russia: ["Russland", "Russian Federation"],
    China: ["People's Republic of China", "PRC"],
    Japan: ["Nippon"],
    "South Korea": ["Korea", "Republic of Korea"],
    "United Arab Emirates": ["UAE", "Emirates"],
    "Czech Republic": ["Czechia", "Tschechien"],
  };

  if (variantMap[name]) {
    variations.push(...variantMap[name]);
  }

  return variations;
}

/**
 * Parses countryInfo.txt content and extracts country data
 */
function parseCountriesContent(content: string): Map<string, string> {
  const countries = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line.trim() === "") continue;

    const parts = line.split("\t");
    if (parts.length < 5) continue;

    const code = parts[0];
    const name = parts[4];

    if (code === undefined || code === "" || name === undefined || name === "")
      continue;

    // Add country name -> code mapping
    countries.set(name.toLowerCase(), code);

    // Add common variations
    // E.g., "United States" also as "USA", "US", "America"
    const variations = getCountryVariations(name, code);
    for (const variation of variations) {
      countries.set(variation.toLowerCase(), code);
    }
  }

  return countries;
}

/**
 * Parses admin1CodesASCII.txt content and extracts region data
 */
function parseRegionsContent(content: string): Map<string, RegionEntry> {
  const regions = new Map<string, RegionEntry>();
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.trim() === "") continue;

    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const code = parts[0]; // Format: "US.CA"
    const name = parts[1];
    const asciiName = parts[2];

    if (code === undefined || code === "" || name === undefined || name === "")
      continue;

    const [countryCode] = code.split(".");
    if (countryCode === undefined || countryCode === "") continue;

    const regionEntry: RegionEntry = { country: countryCode, name };

    // Add region name
    regions.set(name.toLowerCase(), regionEntry);

    // Add ASCII name if different
    if (
      asciiName !== undefined &&
      asciiName !== "" &&
      asciiName.toLowerCase() !== name.toLowerCase()
    ) {
      regions.set(asciiName.toLowerCase(), regionEntry);
    }
  }

  return regions;
}

// =============================================================================
// Data Loading and Lookup
// =============================================================================

/**
 * Initializes semantic data (downloads if needed, then loads)
 */
export async function initializeSemanticData(
  options: {
    autoDownload?: boolean;
    onProgress?: SemanticDownloadProgressCallback;
    onStatus?: (status: string) => void;
  } = {}
): Promise<void> {
  // Ensure data is downloaded
  await ensureSemanticData(options);

  // Load the data
  await loadSemanticData();
}

/**
 * Loads semantic data from cached files
 * @throws Error if required data files are not available
 */
export async function loadSemanticData(): Promise<SemanticData> {
  if (semanticData !== null && semanticData.loaded === true) {
    return semanticData;
  }

  const storage = await getStorage();
  const dataDir = await getSemanticDataCacheDir();

  const isAvailable = await isSemanticDataAvailable();
  if (!isAvailable) {
    throw new Error(
      `Semantic data files not found in ${dataDir}. ` +
        `Use ensureSemanticData() or createAnonymizer({ semantic: { enabled: true, autoDownload: true } }) to download.`
    );
  }

  // Load and parse files
  const nameDictContent = await storage.readTextFile(
    join(dataDir, "nam_dict.txt"),
    "latin1" // File uses ISO-8859-1 encoding
  );
  const names = parseNameDictContent(nameDictContent);

  const citiesContent = await storage.readTextFile(
    join(dataDir, "cities15000.txt")
  );
  const cities = parseCitiesContent(citiesContent);

  const countriesContent = await storage.readTextFile(
    join(dataDir, "countryInfo.txt")
  );
  const countries = parseCountriesContent(countriesContent);

  // admin1 file is optional
  let regions = new Map<string, RegionEntry>();
  try {
    const regionsContent = await storage.readTextFile(
      join(dataDir, "admin1CodesASCII.txt")
    );
    regions = parseRegionsContent(regionsContent);
  } catch {
    // admin1 file is optional
  }

  semanticData = {
    names,
    cities,
    countries,
    regions,
    loaded: true,
  };

  return semanticData;
}

/**
 * Gets the loaded semantic data (loads if not already loaded)
 * Note: This is now async to work with browser storage
 */
export async function getSemanticData(): Promise<SemanticData> {
  if (semanticData === null || semanticData.loaded !== true) {
    return loadSemanticData();
  }
  return semanticData;
}

/**
 * Gets the loaded semantic data synchronously
 * Returns null if data is not yet loaded
 * Use this for performance-critical code paths after initial loading
 */
export function getSemanticDataSync(): SemanticData | null {
  if (semanticData === null || semanticData.loaded !== true) {
    return null;
  }
  return semanticData;
}

/**
 * Clears the loaded semantic data (useful for testing)
 */
export function clearSemanticData(): void {
  semanticData = null;
}

/**
 * Looks up gender for a name
 */
export async function lookupGender(
  name: string,
  locale?: string
): Promise<string | undefined> {
  const data = await getSemanticData();
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
 * Looks up location type (city, country, or region)
 * Priority: country > major city (pop > 500K) > region > other cities
 */
export async function lookupLocationType(
  location: string
): Promise<
  { type: "city" | "country" | "region"; countryCode?: string } | undefined
> {
  const data = await getSemanticData();
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
 * Gets statistics about loaded data
 */
export function getDataStats(): {
  names: number;
  cities: number;
  countries: number;
  regions: number;
  loaded: boolean;
} {
  if (semanticData === null || semanticData.loaded !== true) {
    return { names: 0, cities: 0, countries: 0, regions: 0, loaded: false };
  }

  return {
    names: semanticData.names.size,
    cities: semanticData.cities.size,
    countries: semanticData.countries.size,
    regions: semanticData.regions.size,
    loaded: true,
  };
}
