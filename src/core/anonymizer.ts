/**
 * Core Anonymizer Module
 * Shared implementation for both browser and Node.js entry points
 */

import {
  AnonymizationResult,
  AnonymizationPolicy,
  AnonymizationStats,
  DetectedEntity,
  SemanticConfig,
  SpanMatch,
  PIIType,
  createDefaultPolicy,
} from "../types/index.js";

import {
  createDefaultRegistry,
  RecognizerRegistry,
} from "../recognizers/index.js";

import {
  type INERModel,
  NERModelStub,
  createNERModel,
  createInferenceServerNERModel,
  DEFAULT_LABEL_MAP,
  type OrtSessionOptions,
  type DeviceType,
} from "../ner/index.js";

import {
  type NERModelMode,
  ensureModel,
  type DownloadProgressCallback,
} from "../ner/model-manager.js";

import { prenormalize } from "../pipeline/prenormalize.js";
import { resolveEntities } from "../pipeline/resolver.js";
import { tagEntities, countEntitiesByType, type RawPIIMap } from "../pipeline/tagger.js";
import { validateOutput } from "../pipeline/validator.js";
import { enrichSemantics } from "../pipeline/semantic-enricher.js";
import {
  ensureSemanticData,
  isSemanticDataAvailable,
  loadSemanticData,
} from "../pipeline/semantic-data-loader.js";
import {
  extractTitlesFromSpans,
  mergeAdjacentTitleSpans,
} from "../pipeline/title-extractor.js";
import {
  encryptPIIMap,
  generateKey,
  type KeyProvider,
} from "../crypto/index.js";
import { getStorageProvider } from "#storage";

// Re-export RawPIIMap for session usage
export type { RawPIIMap } from "../pipeline/tagger.js";

// Import actual storage types
import type {
  PIIStorageProvider,
  AnonymizerSession,
} from "../storage/types.js";

// Re-export storage types for convenience
export type { PIIStorageProvider, AnonymizerSession };

/**
 * Merges a partial policy with a base policy (deep merge for Maps/Sets)
 * Unlike the exported mergePolicy, this uses a custom base instead of global defaults
 */
function mergePolicyWithBase(
  base: AnonymizationPolicy,
  partial: Partial<AnonymizationPolicy>
): AnonymizationPolicy {
  // Deep merge confidenceThresholds Map
  let confidenceThresholds = base.confidenceThresholds;
  if (partial.confidenceThresholds !== undefined) {
    confidenceThresholds = new Map(base.confidenceThresholds);
    for (const [type, threshold] of partial.confidenceThresholds) {
      confidenceThresholds.set(type, threshold);
    }
  }

  return {
    enabledTypes: partial.enabledTypes ?? base.enabledTypes,
    regexEnabledTypes: partial.regexEnabledTypes ?? base.regexEnabledTypes,
    nerEnabledTypes: partial.nerEnabledTypes ?? base.nerEnabledTypes,
    typePriority: partial.typePriority ?? base.typePriority,
    confidenceThresholds,
    customIdPatterns: partial.customIdPatterns ?? base.customIdPatterns,
    allowlistTerms: partial.allowlistTerms ?? base.allowlistTerms,
    denylistPatterns: partial.denylistPatterns ?? base.denylistPatterns,
    reuseIdsForRepeatedPII:
      partial.reuseIdsForRepeatedPII ?? base.reuseIdsForRepeatedPII,
    enableLeakScan: partial.enableLeakScan ?? base.enableLeakScan,
    enableSemanticMasking:
      partial.enableSemanticMasking ?? base.enableSemanticMasking,
  };
}

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

  /**
   * ONNX session options for performance tuning
   * Allows customizing execution providers, threading, and graph optimizations
   * @example { executionProviders: ['CoreMLExecutionProvider', 'CPUExecutionProvider'] }
   */
  sessionOptions?: OrtSessionOptions;

  /**
   * Device for inference: 'cpu' (default), 'cuda', or 'tensorrt'
   * GPU devices require Node.js and onnxruntime-node-gpu package
   * @default 'cpu'
   */
  device?: DeviceType;

  /**
   * GPU device ID (default: 0)
   * Only used when device is 'cuda' or 'tensorrt'
   */
  deviceId?: number;

  /**
   * Path to cache TensorRT engines (default: /tmp/rehydra_trt_cache)
   * Only used when device is 'tensorrt'
   * TensorRT engines are GPU-specific; cached engines speed up subsequent loads
   */
  tensorrtCachePath?: string;

  /**
   * Inference backend: 'onnx' (default) or 'inference-server'
   * - 'onnx': Local ONNX Runtime inference (CPU or GPU)
   * - 'inference-server': Remote GPU inference via HTTP (enterprise deployment)
   * @default 'onnx'
   */
  backend?: "onnx" | "inference-server";

  /**
   * Inference server URL (required when backend is 'inference-server')
   * @example 'http://localhost:8080'
   */
  inferenceServerUrl?: string;

  /**
   * Inference server request timeout in milliseconds (default: 30000)
   * Only used when backend is 'inference-server'
   */
  inferenceServerTimeout?: number;
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

  /**
   * PII storage provider for automatic session-based persistence
   * When provided, enables the session() method for automatic PII map storage
   */
  piiStorageProvider?: PIIStorageProvider;

  /** Default policy (uses default if not provided) */
  defaultPolicy?: AnonymizationPolicy;

  /** Model version string */
  modelVersion?: string;

  /** Policy version string */
  policyVersion?: string;
}

/**
 * Session implementation factory type
 */
export type SessionFactory = (
  anonymizer: Anonymizer,
  sessionId: string,
  storage: PIIStorageProvider,
  keyProvider: KeyProvider
) => AnonymizerSession;

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
  private piiStorageProvider: PIIStorageProvider | null;
  private defaultPolicy: AnonymizationPolicy;
  private modelVersion: string;
  private policyVersion: string;
  private initialized = false;
  private semanticDataReady = false;
  private sessionFactory: SessionFactory | null;

  constructor(config: AnonymizerConfig = {}, sessionFactory?: SessionFactory) {
    this.registry = config.registry ?? createDefaultRegistry();
    this.keyProvider = config.keyProvider ?? null;
    this.piiStorageProvider = config.piiStorageProvider ?? null;
    this.defaultPolicy = config.defaultPolicy ?? createDefaultPolicy();
    this.policyVersion = config.policyVersion ?? "1.0.0";
    this.sessionFactory = sessionFactory ?? null;

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

    // Handle NER model setup based on mode and backend
    if (this.nerConfig.mode === "disabled") {
      this.nerModel = new NERModelStub();
    } else if (this.nerConfig.backend === "inference-server") {
      // Inference server backend - use remote GPU inference
      if (
        this.nerConfig.inferenceServerUrl === undefined ||
        this.nerConfig.inferenceServerUrl === ""
      ) {
        throw new Error(
          "NER backend 'inference-server' requires inferenceServerUrl to be set.\n\n" +
            "Example:\n" +
            "  createAnonymizer({\n" +
            "    ner: {\n" +
            "      mode: 'quantized',\n" +
            "      backend: 'inference-server',\n" +
            "      inferenceServerUrl: 'http://localhost:8080',\n" +
            "    }\n" +
            "  })"
        );
      }

      this.nerModel = createInferenceServerNERModel({
        serverUrl: this.nerConfig.inferenceServerUrl,
        timeout: this.nerConfig.inferenceServerTimeout,
        mode: this.nerConfig.mode,
        vocabPath: this.nerConfig.vocabPath,
        modelVersion: this.modelVersion,
        autoDownload: this.nerConfig.autoDownload ?? true,
        onDownloadProgress: this.nerConfig.onDownloadProgress,
        onStatus: this.nerConfig.onStatus,
      });
    } else if (this.nerConfig.mode === "custom") {
      // Custom ONNX model paths
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
        sessionOptions: this.nerConfig.sessionOptions,
        device: this.nerConfig.device,
        deviceId: this.nerConfig.deviceId,
        tensorrtCachePath: this.nerConfig.tensorrtCachePath,
      });
    } else {
      // 'standard' or 'quantized' - use model manager with local ONNX
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
        const storage = await getStorageProvider();
        const labelMapContent = await storage.readTextFile(labelMapPath);
        labelMap = JSON.parse(labelMapContent) as string[];
      } catch {
        // Use default label map
      }

      this.nerModel = createNERModel({
        modelPath,
        vocabPath,
        labelMap,
        modelVersion: this.modelVersion,
        sessionOptions: this.nerConfig.sessionOptions,
        device: this.nerConfig.device,
        deviceId: this.nerConfig.deviceId,
        tensorrtCachePath: this.nerConfig.tensorrtCachePath,
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
      const dataAvailable = await isSemanticDataAvailable();
      if (!dataAvailable) {
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

      // Load data into memory for synchronous access during enrichment
      await loadSemanticData();
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
   * @param existingPiiMap - Optional existing PII map for session-level ID reuse
   * @returns Anonymization result with anonymized text and encrypted PII map
   */
  async anonymize(
    text: string,
    locale?: string,
    policy?: Partial<AnonymizationPolicy>,
    existingPiiMap?: RawPIIMap
  ): Promise<AnonymizationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = performance.now();

    // Merge policy with instance defaults (not global defaults)
    // This ensures semantic config from constructor is preserved
    // Uses deep merge for Maps (confidenceThresholds) and Sets
    const effectivePolicy =
      policy !== undefined
        ? mergePolicyWithBase(this.defaultPolicy, policy)
        : this.defaultPolicy;

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
      effectivePolicy,
      existingPiiMap
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

  /**
   * Creates a session-bound interface for automatic PII map storage
   *
   * @param sessionId - Unique identifier for this session/conversation
   * @returns AnonymizerSession that auto-saves on anonymize and auto-loads on rehydrate
   * @throws Error if piiStorageProvider was not configured
   *
   * @example
   * ```typescript
   * const session = anonymizer.session('chat-123');
   *
   * // Anonymize - auto-saves to storage
   * const result = await session.anonymize('Hello John Smith!');
   *
   * // Rehydrate - auto-loads and decrypts
   * const original = await session.rehydrate(translatedText);
   * ```
   */
  session(sessionId: string): AnonymizerSession {
    if (this.piiStorageProvider === null) {
      throw new Error(
        "Cannot create session: piiStorageProvider not configured.\n\n" +
          "Configure storage when creating the anonymizer:\n" +
          "  const anonymizer = createAnonymizer({\n" +
          "    piiStorageProvider: new InMemoryPIIStorageProvider(),\n" +
          "    keyProvider: new InMemoryKeyProvider(),\n" +
          "  });"
      );
    }

    if (this.keyProvider === null) {
      throw new Error(
        "Cannot create session: keyProvider not configured.\n\n" +
          "A key provider is required for session-based storage to decrypt PII maps.\n" +
          "Configure it when creating the anonymizer:\n" +
          "  const anonymizer = createAnonymizer({\n" +
          "    piiStorageProvider: storage,\n" +
          "    keyProvider: new InMemoryKeyProvider(),\n" +
          "  });"
      );
    }

    if (this.sessionFactory === null) {
      throw new Error(
        "Session factory not configured. This is an internal error."
      );
    }

    return this.sessionFactory(
      this,
      sessionId,
      this.piiStorageProvider,
      this.keyProvider
    );
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
export function createAnonymizer(config?: AnonymizerConfig, sessionFactory?: SessionFactory): Anonymizer {
  return new Anonymizer(config, sessionFactory);
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

