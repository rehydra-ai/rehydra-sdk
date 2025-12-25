/**
 * Bridge Anonymization Module
 * Main entry point for on-device PII anonymization
 */

// Re-export types
export * from "./types/index.js";

// Re-export recognizers
export {
  Recognizer,
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
export {
  encryptPIIMap,
  decryptPIIMap,
  generateKey,
  deriveKey,
  generateSalt,
  KeyProvider,
  InMemoryKeyProvider,
  ConfigKeyProvider,
  validateKey,
  secureCompare,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "./crypto/index.js";

// Main anonymization imports
import {
  AnonymizationResult,
  AnonymizationPolicy,
  AnonymizationStats,
  DetectedEntity,
  SemanticConfig,
  SpanMatch,
  PIIType,
  createDefaultPolicy,
  mergePolicy,
} from "./types/index.js";
import {
  createDefaultRegistry,
  RecognizerRegistry,
} from "./recognizers/index.js";
import {
  type INERModel,
  NERModelStub,
  createNERModel,
  DEFAULT_LABEL_MAP,
} from "./ner/index.js";
import {
  type NERModelMode,
  ensureModel,
  type DownloadProgressCallback,
} from "./ner/model-manager.js";
import { prenormalize } from "./pipeline/prenormalize.js";
import { resolveEntities } from "./pipeline/resolver.js";
import { tagEntities, countEntitiesByType } from "./pipeline/tagger.js";
import { validateOutput } from "./pipeline/validator.js";
import { enrichSemantics } from "./pipeline/semantic-enricher.js";
import {
  ensureSemanticData,
  isSemanticDataAvailable,
} from "./pipeline/semantic-data-loader.js";
import {
  extractTitlesFromSpans,
  mergeAdjacentTitleSpans,
} from "./pipeline/title-extractor.js";
import {
  encryptPIIMap,
  generateKey,
  type KeyProvider,
} from "./crypto/index.js";
import * as fs from "fs/promises";

/**
 * NER configuration options
 */
export interface NERConfig {
  /**
   * NER model mode:
   * - 'standard': Full-size multilingual model (~1.1 GB)
   * - 'quantized': Smaller quantized model (~280 MB)
   * - 'disabled': No NER, regex-only detection
   * - 'custom': Use custom model paths
   */
  mode: NERModelMode;

  /**
   * Custom model path (required when mode is 'custom')
   */
  modelPath?: string;

  /**
   * Custom vocab path (required when mode is 'custom')
   */
  vocabPath?: string;

  /**
   * Whether to auto-download model if not present
   * @default true
   */
  autoDownload?: boolean;

  /**
   * Callback for download progress
   */
  onDownloadProgress?: DownloadProgressCallback;

  /**
   * Callback for status messages
   */
  onStatus?: (status: string) => void;

  /**
   * Confidence thresholds per PII type (0.0 - 1.0)
   * Overrides default thresholds for specified types
   * @example { PERSON: 0.8, ORG: 0.7 }
   */
  thresholds?: Partial<Record<PIIType, number>>;
}

/**
 * Anonymizer configuration
 */
export interface AnonymizerConfig {
  /** Recognizer registry (uses default if not provided) */
  registry?: RecognizerRegistry;

  /**
   * NER configuration
   * @default { mode: 'disabled' }
   */
  ner?: NERConfig;

  /**
   * Semantic enrichment configuration
   * Enables MT-friendly PII tags with gender/scope attributes
   * @default { enabled: false }
   */
  semantic?: SemanticConfig;

  /** Key provider for encryption (generates random key if not provided) */
  keyProvider?: KeyProvider;

  /** Default policy (uses default if not provided) */
  defaultPolicy?: AnonymizationPolicy;

  /** Model version string */
  modelVersion?: string;

  /** Policy version string */
  policyVersion?: string;
}

/**
 * Anonymizer instance
 * Main class for performing PII anonymization
 */
export class Anonymizer {
  private registry: RecognizerRegistry;
  private nerModel: INERModel | null = null;
  private nerConfig: NERConfig;
  private semanticConfig: SemanticConfig;
  private keyProvider: KeyProvider | null;
  private defaultPolicy: AnonymizationPolicy;
  private modelVersion: string;
  private policyVersion: string;
  private initialized = false;
  private semanticDataReady = false;

  constructor(config: AnonymizerConfig = {}) {
    this.registry = config.registry ?? createDefaultRegistry();
    this.keyProvider = config.keyProvider ?? null;
    this.defaultPolicy = config.defaultPolicy ?? createDefaultPolicy();
    this.policyVersion = config.policyVersion ?? "1.0.0";

    // Handle NER configuration
    this.nerConfig = config.ner ?? { mode: "disabled" };
    this.modelVersion = config.modelVersion ?? "1.0.0";

    // Merge NER thresholds into default policy if provided
    if (this.nerConfig.thresholds !== undefined) {
      const thresholdsMap = new Map(this.defaultPolicy.confidenceThresholds);
      for (const [type, threshold] of Object.entries(
        this.nerConfig.thresholds
      )) {
        if (threshold !== undefined) {
          thresholdsMap.set(type as PIIType, threshold);
        }
      }
      this.defaultPolicy = {
        ...this.defaultPolicy,
        confidenceThresholds: thresholdsMap,
      };
    }

    // Handle semantic configuration
    this.semanticConfig = config.semantic ?? { enabled: false };

    // If semantic is enabled, also enable it in the default policy
    if (this.semanticConfig.enabled) {
      this.defaultPolicy = {
        ...this.defaultPolicy,
        enableSemanticMasking: true,
      };
    }
  }

  /**
   * Initializes the anonymizer
   * Downloads NER model and semantic data if needed and loads them
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Handle NER model setup based on mode
    if (this.nerConfig.mode === "disabled") {
      this.nerModel = new NERModelStub();
    } else if (this.nerConfig.mode === "custom") {
      if (
        this.nerConfig.modelPath === undefined ||
        this.nerConfig.modelPath === "" ||
        this.nerConfig.vocabPath === undefined ||
        this.nerConfig.vocabPath === ""
      ) {
        throw new Error("NER mode 'custom' requires modelPath and vocabPath");
      }

      this.nerModel = createNERModel({
        modelPath: this.nerConfig.modelPath,
        vocabPath: this.nerConfig.vocabPath,
        modelVersion: this.modelVersion,
      });
    } else {
      // 'standard' or 'quantized' - use model manager
      const { modelPath, vocabPath, labelMapPath } = await ensureModel(
        this.nerConfig.mode,
        {
          autoDownload: this.nerConfig.autoDownload ?? true,
          onProgress: this.nerConfig.onDownloadProgress,
          onStatus: this.nerConfig.onStatus,
        }
      );

      // Load label map
      let labelMap = DEFAULT_LABEL_MAP;
      try {
        const labelMapContent = await fs.readFile(labelMapPath, "utf-8");
        labelMap = JSON.parse(labelMapContent) as string[];
      } catch {
        // Use default label map
      }

      this.nerModel = createNERModel({
        modelPath,
        vocabPath,
        labelMap,
        modelVersion: this.modelVersion,
      });
    }

    // Load the NER model
    if (!this.nerModel.loaded) {
      this.nerConfig.onStatus?.("Loading NER model...");
      await this.nerModel.load();
      this.nerConfig.onStatus?.("NER model loaded!");
    }

    // Handle semantic data setup if enabled
    if (this.semanticConfig.enabled) {
      const autoDownload = this.semanticConfig.autoDownload ?? true;

      // Check if data is already available
      if (!isSemanticDataAvailable()) {
        if (!autoDownload) {
          throw new Error(
            "Semantic masking is enabled but data files are not available.\n\n" +
              "To download automatically, use:\n" +
              "  createAnonymizer({ semantic: { enabled: true, autoDownload: true } })\n\n" +
              "Or disable semantic masking:\n" +
              "  createAnonymizer({ semantic: { enabled: false } })"
          );
        }

        // Download semantic data
        await ensureSemanticData({
          autoDownload: true,
          onProgress: this.semanticConfig.onDownloadProgress,
          onStatus: this.semanticConfig.onStatus,
        });
      } else {
        this.semanticConfig.onStatus?.("Semantic data already cached");
      }

      this.semanticDataReady = true;
    }

    this.modelVersion = this.nerModel.version;
    this.initialized = true;
  }

  /**
   * Anonymizes text, replacing PII with placeholder tags
   * @param text - Input text to anonymize
   * @param locale - Optional locale hint (e.g., 'de-DE', 'en-US')
   * @param policy - Optional policy override
   * @returns Anonymization result with anonymized text and encrypted PII map
   */
  async anonymize(
    text: string,
    locale?: string,
    policy?: Partial<AnonymizationPolicy>
  ): Promise<AnonymizationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = performance.now();

    // Merge policy with defaults
    const effectivePolicy =
      policy !== undefined ? mergePolicy(policy) : this.defaultPolicy;

    // Step 1: Pre-normalize text
    const normalizedText = prenormalize(text);

    // Step 2: Run regex recognizers
    const regexMatches = this.registry.findAll(normalizedText, effectivePolicy);

    // Step 3: Run NER model
    const nerResult = await this.nerModel!.predict(
      normalizedText,
      effectivePolicy
    );
    const nerMatches = nerResult.spans;

    // Step 4: Resolve and merge entities
    const resolvedMatches = resolveEntities(
      regexMatches,
      nerMatches,
      effectivePolicy,
      normalizedText
    );

    // Step 4.5: Merge adjacent title+name PERSON spans (if semantic masking enabled)
    // This fixes NER models that split "Mrs. Smith" into two entities
    const mergedMatches: SpanMatch[] =
      effectivePolicy.enableSemanticMasking === true
        ? mergeAdjacentTitleSpans(resolvedMatches, normalizedText)
        : resolvedMatches;

    // Step 4.6: Extract titles from PERSON entities (if semantic masking enabled)
    // This strips honorific titles (Dr., Mrs., etc.) so they remain visible for translation
    const titleExtractedMatches = effectivePolicy.enableSemanticMasking
      ? extractTitlesFromSpans(mergedMatches, normalizedText)
      : mergedMatches;

    // Step 4.6: Enrich with semantic attributes (if enabled)
    // This adds gender for PERSON and scope for LOCATION entities
    const enrichedMatches = effectivePolicy.enableSemanticMasking
      ? enrichSemantics(titleExtractedMatches, {
          locale: locale !== undefined ? locale.split("-")[0] : undefined, // Extract language code
        })
      : titleExtractedMatches;

    // Step 5: Tag entities and build PII map
    const { anonymizedText, entities, piiMap } = tagEntities(
      normalizedText,
      enrichedMatches,
      effectivePolicy
    );

    // Step 6: Validate output
    const validation = validateOutput(
      anonymizedText,
      entities,
      Array.from(piiMap.keys()),
      effectivePolicy
    );

    if (!validation.valid) {
      // Log validation errors (but don't expose raw PII)
      const safeErrors = validation.errors.map((e) => ({
        code: e.code,
        message: e.message,
      }));
      // eslint-disable-next-line no-console
      console.warn("Validation warnings:", safeErrors);
    }

    // Step 7: Encrypt PII map
    const encryptionKey =
      this.keyProvider !== null
        ? await this.keyProvider.getKey()
        : generateKey();

    const encryptedPiiMap = await encryptPIIMap(piiMap, encryptionKey);

    // Step 8: Build stats
    const endTime = performance.now();
    const stats: AnonymizationStats = {
      countsByType: countEntitiesByType(entities),
      totalEntities: entities.length,
      modelVersion: this.modelVersion,
      policyVersion: this.policyVersion,
      processingTimeMs: endTime - startTime,
      leakScanPassed: validation.leakScanPassed,
    };

    // Step 9: Build result (without original text in entities)
    const safeEntities: Omit<DetectedEntity, "original">[] = entities.map(
      ({ original: _original, ...rest }) => rest
    );

    return {
      anonymizedText,
      entities: safeEntities,
      piiMap: encryptedPiiMap,
      stats,
    };
  }

  /**
   * Disposes of resources
   */
  async dispose(): Promise<void> {
    if (this.nerModel) {
      await this.nerModel.dispose();
    }
    this.initialized = false;
  }

  /**
   * Gets the recognizer registry
   */
  getRegistry(): RecognizerRegistry {
    return this.registry;
  }

  /**
   * Gets the NER model
   */
  getNERModel(): INERModel | null {
    return this.nerModel;
  }

  /**
   * Whether the anonymizer is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
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

/**
 * Convenience function for one-off anonymization
 * Creates a temporary anonymizer with default settings (regex-only)
 */
export async function anonymize(
  text: string,
  locale?: string,
  policy?: Partial<AnonymizationPolicy>
): Promise<AnonymizationResult> {
  const anonymizer = createAnonymizer();
  await anonymizer.initialize();

  try {
    return await anonymizer.anonymize(text, locale, policy);
  } finally {
    await anonymizer.dispose();
  }
}

/**
 * Quick regex-only anonymization (no NER, faster)
 */
export async function anonymizeRegexOnly(
  text: string,
  policy?: Partial<AnonymizationPolicy>
): Promise<AnonymizationResult> {
  // Create policy with NER disabled
  const regexOnlyPolicy: Partial<AnonymizationPolicy> = {
    ...policy,
    nerEnabledTypes: new Set(), // Disable all NER types
  };

  return anonymize(text, undefined, regexOnlyPolicy);
}

/**
 * Full anonymization with NER
 * Auto-downloads the quantized model on first use
 *
 * @example
 * ```typescript
 * const result = await anonymizeWithNER(
 *   'Contact John Smith at john@example.com',
 *   {
 *     mode: 'quantized',
 *     onStatus: console.log
 *   }
 * );
 * ```
 */
export async function anonymizeWithNER(
  text: string,
  nerConfig: Omit<NERConfig, "mode"> & { mode?: "standard" | "quantized" },
  policy?: Partial<AnonymizationPolicy>
): Promise<AnonymizationResult> {
  const anonymizer = createAnonymizer({
    ner: {
      mode: nerConfig.mode ?? "quantized",
      ...nerConfig,
    },
  });

  await anonymizer.initialize();

  try {
    return await anonymizer.anonymize(text, undefined, policy);
  } finally {
    await anonymizer.dispose();
  }
}
