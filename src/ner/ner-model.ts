/**
 * NER Model Wrapper
 * ONNX Runtime integration for Named Entity Recognition
 * Supports both onnxruntime-node and onnxruntime-web
 */

import { loadRuntime, type OrtRuntime } from "./onnx-runtime.js";
import { SpanMatch, AnonymizationPolicy } from "../types/index.js";
import {
  WordPieceTokenizer,
  loadVocabFromFile,
  type TokenizationResult,
} from "./tokenizer.js";
import {
  decodeBIOTags,
  convertToSpanMatches,
  cleanupSpanBoundaries,
  mergeAdjacentSpans,
} from "./bio-decoder.js";
import { getStorageProvider, isBrowser } from "../utils/storage.js";

/**
 * NER Model configuration
 */
export interface NERModelConfig {
  /** Path to ONNX model file */
  modelPath: string;
  /** Path to vocabulary file */
  vocabPath: string;
  /** Label mapping (index -> label string) */
  labelMap: string[];
  /** Maximum sequence length */
  maxLength: number;
  /** Whether model expects lowercase input */
  doLowerCase: boolean;
  /** Model version for tracking */
  modelVersion: string;
}

/**
 * NER prediction result for a single text
 */
export interface NERPrediction {
  /** Detected entity spans */
  spans: SpanMatch[];
  /** Processing time in ms */
  processingTimeMs: number;
  /** Model version used */
  modelVersion: string;
}

/**
 * Default label map for common NER models (CoNLL-style)
 */
export const DEFAULT_LABEL_MAP = [
  "O",
  "B-PER",
  "I-PER",
  "B-ORG",
  "I-ORG",
  "B-LOC",
  "I-LOC",
  "B-MISC",
  "I-MISC",
];

/**
 * NER Model wrapper for ONNX inference
 */
export class NERModel {
  private ort: OrtRuntime | null = null;
  private session: unknown = null;
  private tokenizer: WordPieceTokenizer | null = null;
  private config: NERModelConfig;
  private isLoaded = false;

  constructor(config: NERModelConfig) {
    this.config = config;
  }

  /**
   * Loads the model and tokenizer
   */
  async load(): Promise<void> {
    if (this.isLoaded) return;

    // Load ONNX runtime (auto-detects best runtime for environment)
    this.ort = await loadRuntime();

    // Load ONNX model
    // In browsers, we need to load the model as ArrayBuffer since file paths don't work
    // onnxruntime-web accepts ArrayBuffer/Uint8Array, while onnxruntime-node accepts file paths
    if (isBrowser()) {
      const storage = await getStorageProvider();
      const modelData = await storage.readFile(this.config.modelPath);
      // onnxruntime-web accepts Uint8Array directly
      this.session = await this.ort.InferenceSession.create(modelData);
    } else {
      // In Node.js, we can use the file path directly
      this.session = await this.ort.InferenceSession.create(
        this.config.modelPath
      );
    }

    // Load tokenizer vocabulary (already uses storage abstraction internally)
    const vocab = await loadVocabFromFile(this.config.vocabPath);
    this.tokenizer = new WordPieceTokenizer(vocab, {
      maxLength: this.config.maxLength,
      doLowerCase: this.config.doLowerCase,
    });

    this.isLoaded = true;
  }

  /**
   * Predicts entities in text
   */
  async predict(
    text: string,
    policy?: AnonymizationPolicy
  ): Promise<NERPrediction> {
    const startTime = performance.now();

    if (!this.isLoaded || this.session === null || this.tokenizer === null) {
      throw new Error("Model not loaded. Call load() first.");
    }

    // Tokenize input
    const tokenization = this.tokenizer.tokenize(text);

    // Run inference
    const { labels, confidences } = await this.runInference(tokenization);

    // Decode BIO tags to entities
    const rawEntities = decodeBIOTags(
      tokenization.tokens,
      labels,
      confidences,
      text
    );

    // Convert to SpanMatch format with confidence filtering
    const minConfidence = this.getMinConfidence(policy);
    let spans = convertToSpanMatches(rawEntities, minConfidence);

    // Post-process spans
    spans = cleanupSpanBoundaries(spans, text);
    spans = mergeAdjacentSpans(spans, text);

    // Filter by enabled types in policy
    if (policy !== undefined) {
      spans = spans.filter(
        (span) =>
          policy.enabledTypes.has(span.type) &&
          policy.nerEnabledTypes.has(span.type)
      );
    }

    const endTime = performance.now();

    return {
      spans,
      processingTimeMs: endTime - startTime,
      modelVersion: this.config.modelVersion,
    };
  }

  /**
   * Runs ONNX inference
   */
  private async runInference(
    tokenization: TokenizationResult
  ): Promise<{ labels: string[]; confidences: number[] }> {
    if (this.session === null || this.ort === null) {
      throw new Error("Session not initialized");
    }

    const session = this.session as {
      inputNames: readonly string[];
      outputNames: readonly string[];
      run(
        feeds: Record<string, unknown>
      ): Promise<Record<string, { data: Float32Array }>>;
    };

    const seqLength = tokenization.inputIds.length;

    // Create tensors
    const inputIdsTensor = new this.ort.Tensor(
      "int64",
      BigInt64Array.from(tokenization.inputIds.map(BigInt)),
      [1, seqLength]
    );

    const attentionMaskTensor = new this.ort.Tensor(
      "int64",
      BigInt64Array.from(tokenization.attentionMask.map(BigInt)),
      [1, seqLength]
    );

    const tokenTypeIdsTensor = new this.ort.Tensor(
      "int64",
      BigInt64Array.from(tokenization.tokenTypeIds.map(BigInt)),
      [1, seqLength]
    );

    // Run inference
    const feeds: Record<string, unknown> = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
    };

    // Some models also need token_type_ids
    const inputNames = session.inputNames;
    if (inputNames.includes("token_type_ids")) {
      feeds["token_type_ids"] = tokenTypeIdsTensor;
    }

    const results = await session.run(feeds);

    // Get logits output
    const outputName = session.outputNames[0];
    if (outputName === undefined) {
      throw new Error("No output from model");
    }

    const logits = results[outputName];
    if (logits === undefined) {
      throw new Error("Logits output not found");
    }

    // Process logits to get labels and confidences
    return this.processLogits(logits, seqLength);
  }

  /**
   * Processes model logits to extract labels and confidences
   */
  private processLogits(
    logits: { data: Float32Array },
    seqLength: number
  ): { labels: string[]; confidences: number[] } {
    const data = logits.data;
    const numLabels = this.config.labelMap.length;

    const labels: string[] = [];
    const confidences: number[] = [];

    for (let i = 0; i < seqLength; i++) {
      // Get logits for this token
      const tokenLogits: number[] = [];
      for (let j = 0; j < numLabels; j++) {
        tokenLogits.push(data[i * numLabels + j] ?? 0);
      }

      // Apply softmax
      const probs = softmax(tokenLogits);

      // Get argmax
      let maxIdx = 0;
      let maxProb = probs[0] ?? 0;
      for (let j = 1; j < probs.length; j++) {
        if ((probs[j] ?? 0) > maxProb) {
          maxProb = probs[j] ?? 0;
          maxIdx = j;
        }
      }

      labels.push(this.config.labelMap[maxIdx] ?? "O");
      confidences.push(maxProb);
    }

    return { labels, confidences };
  }

  /**
   * Gets minimum confidence threshold from policy
   */
  private getMinConfidence(policy?: AnonymizationPolicy): number {
    if (policy === undefined) return 0.5;

    // Get minimum from all NER-enabled types
    let minThreshold = 1.0;
    for (const type of policy.nerEnabledTypes) {
      const threshold = policy.confidenceThresholds.get(type) ?? 0.5;
      if (threshold < minThreshold) {
        minThreshold = threshold;
      }
    }

    return minThreshold;
  }

  /**
   * Gets model version
   */
  get version(): string {
    return this.config.modelVersion;
  }

  /**
   * Checks if model is loaded
   */
  get loaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Disposes of model resources
   */
  dispose(): Promise<void> {
    // ONNX Runtime Node doesn't have explicit dispose, but we can clear references
    this.session = null;
    this.tokenizer = null;
    this.isLoaded = false;
    return Promise.resolve();
  }
}

/**
 * Softmax function for probability calculation
 */
function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const expLogits = logits.map((x) => Math.exp(x - maxLogit));
  const sumExp = expLogits.reduce((a, b) => a + b, 0);
  return expLogits.map((x) => x / sumExp);
}

/**
 * Creates a NER model instance with configuration
 */
export function createNERModel(
  config: Partial<NERModelConfig> & { modelPath: string; vocabPath: string }
): NERModel {
  const fullConfig: NERModelConfig = {
    modelPath: config.modelPath,
    vocabPath: config.vocabPath,
    labelMap: config.labelMap ?? DEFAULT_LABEL_MAP,
    maxLength: config.maxLength ?? 512,
    doLowerCase: config.doLowerCase ?? false, // XLM-RoBERTa is cased
    modelVersion: config.modelVersion ?? "1.0.0",
  };

  return new NERModel(fullConfig);
}

/**
 * NER Model stub for when no model is available
 * Returns empty results - useful for regex-only mode
 */
export class NERModelStub {
  readonly version = "stub-1.0.0";
  readonly loaded = true;

  async load(): Promise<void> {
    // No-op
  }

  predict(
    _text: string,
    _policy?: AnonymizationPolicy
  ): Promise<NERPrediction> {
    return Promise.resolve({
      spans: [],
      processingTimeMs: 0,
      modelVersion: this.version,
    });
  }

  dispose(): Promise<void> {
    // No-op
    return Promise.resolve();
  }
}

/**
 * Creates a stub NER model (for testing or regex-only mode)
 */
export function createNERModelStub(): NERModelStub {
  return new NERModelStub();
}

/**
 * NER model interface for dependency injection
 */
export interface INERModel {
  readonly version: string;
  readonly loaded: boolean;
  load(): Promise<void>;
  predict(text: string, policy?: AnonymizationPolicy): Promise<NERPrediction>;
  dispose(): Promise<void>;
}
