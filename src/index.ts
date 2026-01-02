/**
 * Rehydra Module
 * Main entry point for on-device PII anonymization
 */

// Re-export types
export * from "./types/index.js";

// Re-export recognizers
export type { Recognizer } from "./recognizers/index.js";
export {
  RegexRecognizer,
  RecognizerRegistry,
  createDefaultRegistry,
  createRegistry,
  getGlobalRegistry,
  emailRecognizer,
  phoneRecognizer,
  ibanRecognizer,
  bicSwiftRecognizer,
  creditCardRecognizer,
  ipAddressRecognizer,
  urlRecognizer,
  createCustomIdRecognizer,
  createCaseIdRecognizer,
  createCustomerIdRecognizer,
} from "./recognizers/index.js";

// Re-export NER components
export {
  NERModel,
  NERModelStub,
  createNERModel,
  createNERModelStub,
  WordPieceTokenizer,
  loadVocabFromFile,
  parseVocab,
  loadRuntime,
  detectRuntime,
  getRuntimeType,
  type INERModel,
  type NERModelConfig,
  type NERPrediction,
  type NERModelMode,
  type DownloadProgressCallback,
  type OrtSessionOptions,
  MODEL_REGISTRY,
  getModelCacheDir,
  isModelDownloaded,
  downloadModel,
  ensureModel,
  clearModelCache,
  listDownloadedModels,
} from "./ner/index.js";

// Re-export pipeline components
export {
  prenormalize,
  resolveEntities,
  tagEntities,
  validateOutput,
  generateTag,
  parseTag,
  rehydrate,
  enrichSemantics,
  inferGender,
  classifyLocation,
  getDatabaseStats,
  hasName,
  hasLocation,
  // Semantic data loader exports
  isSemanticDataAvailable,
  isSemanticDataDownloaded,
  getSemanticDataCacheDir,
  getDataDirectory,
  downloadSemanticData,
  ensureSemanticData,
  initializeSemanticData,
  loadSemanticData,
  clearSemanticData,
  clearSemanticDataCache,
  getSemanticDataInfo,
  SEMANTIC_DATA_FILES,
  // Title extractor exports
  extractTitle,
  extractTitlesFromSpans,
  mergeAdjacentTitleSpans,
  getTitlesForLanguage,
  getAllTitles,
  startsWithTitle,
  isOnlyTitle,
  type SemanticDataFileInfo,
  type EnricherConfig,
  type GenderResult,
  type LocationResult,
  type TitleExtractionResult,
} from "./pipeline/index.js";

// Re-export crypto
export type { KeyProvider } from "./crypto/index.js";
export {
  encryptPIIMap,
  decryptPIIMap,
  generateKey,
  deriveKey,
  generateSalt,
  InMemoryKeyProvider,
  ConfigKeyProvider,
  validateKey,
  secureCompare,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "./crypto/index.js";

// Re-export storage utilities (file system abstraction)
export {
  getStorageProvider,
  isNode,
  isBrowser,
  resetStorageProvider,
  setStorageProvider,
  type StorageProvider,
} from "#storage";

// Re-export PII storage providers (for persisting encrypted PII maps)
// This includes SQLitePIIStorageProvider for Node.js
export {
  type PIIStorageProvider,
  type PIIMapMetadata,
  type StoredPIIMap,
  type ListOptions,
  type AnonymizerSession,
  InMemoryPIIStorageProvider,
  SQLitePIIStorageProvider,
  IndexedDBPIIStorageProvider,
} from "./storage/index.js";

// Re-export path utilities
export {
  join as pathJoin,
  dirname as pathDirname,
  basename as pathBasename,
  normalize as pathNormalize,
  extname as pathExtname,
  isAbsolute as pathIsAbsolute,
} from "./utils/path.js";

// Import core anonymizer components
import {
  Anonymizer as AnonymizerCore,
  anonymize as anonymizeCore,
  anonymizeRegexOnly as anonymizeRegexOnlyCore,
  anonymizeWithNER as anonymizeWithNERCore,
  type AnonymizerConfig,
  type NERConfig,
} from "./core/index.js";

// Import session implementation
import { AnonymizerSessionImpl } from "./storage/session.js";

// Re-export types from core
export type { AnonymizerConfig, NERConfig };

/**
 * Anonymizer instance
 * Main class for performing PII anonymization
 */
export class Anonymizer extends AnonymizerCore {
  constructor(config: AnonymizerConfig = {}) {
    super(config, (anonymizer, sessionId, storage, keyProvider) => {
      return new AnonymizerSessionImpl(
        anonymizer,
        sessionId,
        storage,
        keyProvider
      );
    });
  }
}

/**
 * Creates an anonymizer with the specified configuration
 *
 * @example
 * ```typescript
 * // Regex-only (no NER)
 * const anonymizer = createAnonymizer();
 *
 * // With NER (auto-downloads model on first use)
 * const anonymizer = createAnonymizer({
 *   ner: { mode: 'quantized' }
 * });
 *
 * // With NER and progress callback
 * const anonymizer = createAnonymizer({
 *   ner: {
 *     mode: 'standard',
 *     onStatus: (status) => console.log(status),
 *     onDownloadProgress: (p) => console.log(`${p.file}: ${p.percent}%`)
 *   }
 * });
 * ```
 */
export function createAnonymizer(config?: AnonymizerConfig): Anonymizer {
  return new Anonymizer(config);
}

// Re-export standalone functions from core
export const anonymize = anonymizeCore;
export const anonymizeRegexOnly = anonymizeRegexOnlyCore;
export const anonymizeWithNER = anonymizeWithNERCore;
