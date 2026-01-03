/**
 * Inference Server NER Model
 * NER model that uses remote GPU inference server for acceleration
 */

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
import {
  InferenceServerClient,
  type InferenceServerConfig,
} from "./inference-server-client.js";
import {
  type NERModelMode,
  ensureModel,
  type DownloadProgressCallback,
} from "./model-manager.js";
import type { INERModel, NERPrediction } from "./ner-model.js";
import { DEFAULT_LABEL_MAP } from "./ner-model.js";

/**
 * Configuration for the Inference Server NER model
 */
export interface InferenceServerNERModelConfig {
  /** Inference server URL (e.g., 'http://localhost:8080') */
  serverUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Model mode for vocab/label loading ('quantized' or 'standard') */
  mode?: NERModelMode;
  /** Custom vocabulary file path (for mode: 'custom') */
  vocabPath?: string;
  /** Custom label map (default: standard NER labels) */
  labelMap?: string[];
  /** Model version string */
  modelVersion?: string;
  /** Auto-download models if not present (default: true) */
  autoDownload?: boolean;
  /** Download progress callback */
  onDownloadProgress?: DownloadProgressCallback;
  /** Status callback */
  onStatus?: (message: string) => void;
}

/**
 * NER Model implementation that delegates inference to a remote GPU server.
 * 
 * This provides enterprise-grade GPU acceleration without requiring GPU
 * drivers or ONNX Runtime GPU packages in the Node.js environment.
 * 
 * The server handles:
 * - GPU memory management
 * - TensorRT optimization and engine caching
 * - Batch processing for high throughput
 * 
 * The SDK handles:
 * - Tokenization
 * - BIO tag decoding
 * - Entity post-processing
 */
export class InferenceServerNERModel implements INERModel {
  private client: InferenceServerClient;
  private tokenizer: WordPieceTokenizer | null = null;
  private config: InferenceServerNERModelConfig;
  private labelMap: string[];
  private isLoaded = false;
  private vocabPath: string | null = null;
  readonly version: string;

  constructor(config: InferenceServerNERModelConfig) {
    this.config = config;
    this.version = config.modelVersion ?? "1.0.0";
    this.labelMap = config.labelMap ?? DEFAULT_LABEL_MAP;
    
    this.client = new InferenceServerClient({
      url: config.serverUrl,
      timeout: config.timeout,
    });
  }

  /**
   * Check if model is loaded and ready
   */
  get loaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Load the model (vocab + verify server connection)
   */
  async load(): Promise<void> {
    if (this.isLoaded) return;

    this.config.onStatus?.("Connecting to inference server...");

    // Verify server is healthy
    try {
      const health = await this.client.health();
      if (!health.model_loaded) {
        this.config.onStatus?.("Waiting for inference server to load model...");
        await this.client.waitUntilReady();
      }
      this.config.onStatus?.(`Connected to inference server (${health.provider})`);
    } catch (error) {
      throw new Error(
        `Failed to connect to inference server at ${this.config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Determine vocab path
    if (this.config.vocabPath) {
      this.vocabPath = this.config.vocabPath;
    } else {
      // Use model manager to get/download vocab
      const mode = this.config.mode ?? "quantized";
      if (mode !== "disabled" && mode !== "custom") {
        this.config.onStatus?.("Ensuring model vocabulary is available...");
        const { vocabPath, labelMapPath } = await ensureModel(mode, {
          autoDownload: this.config.autoDownload ?? true,
          onProgress: this.config.onDownloadProgress,
          onStatus: this.config.onStatus,
        });
        this.vocabPath = vocabPath;

        // Try to load label map
        try {
          const { getStorageProvider } = await import("#storage");
          const storage = await getStorageProvider();
          const labelMapContent = await storage.readTextFile(labelMapPath);
          this.labelMap = JSON.parse(labelMapContent) as string[];
        } catch {
          // Use default label map
        }
      }
    }

    // Load tokenizer
    if (this.vocabPath) {
      this.config.onStatus?.("Loading tokenizer...");
      const vocab = await loadVocabFromFile(this.vocabPath);
      this.tokenizer = new WordPieceTokenizer(vocab, {
        maxLength: 512,
        doLowerCase: false, // XLM-RoBERTa is cased
      });
    } else {
      throw new Error("No vocabulary path available. Set vocabPath or mode.");
    }

    this.isLoaded = true;
    this.config.onStatus?.("Model ready");
  }

  /**
   * Predict entities in text
   */
  async predict(
    text: string,
    policy?: AnonymizationPolicy
  ): Promise<NERPrediction> {
    const startTime = performance.now();

    if (!this.isLoaded || this.tokenizer === null) {
      throw new Error("Model not loaded. Call load() first.");
    }

    // Tokenize input
    const tokenization = this.tokenizer.tokenize(text);

    // Run inference via server
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
      modelVersion: this.version,
    };
  }

  /**
   * Run inference via the server
   */
  private async runInference(
    tokenization: TokenizationResult
  ): Promise<{ labels: string[]; confidences: number[] }> {
    // Call server
    const logits = await this.client.infer(
      tokenization.inputIds,
      tokenization.attentionMask
    );

    // Process logits to get labels and confidences
    return this.processLogits(logits, tokenization.inputIds.length);
  }

  /**
   * Process logits to extract labels and confidences
   */
  private processLogits(
    logits: Float32Array,
    seqLength: number
  ): { labels: string[]; confidences: number[] } {
    const numLabels = this.labelMap.length;
    const labels: string[] = [];
    const confidences: number[] = [];

    for (let i = 0; i < seqLength; i++) {
      // Get logits for this token
      const tokenLogits: number[] = [];
      for (let j = 0; j < numLabels; j++) {
        tokenLogits.push(logits[i * numLabels + j] ?? 0);
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

      labels.push(this.labelMap[maxIdx] ?? "O");
      confidences.push(maxProb);
    }

    return { labels, confidences };
  }

  /**
   * Get minimum confidence threshold from policy
   */
  private getMinConfidence(policy?: AnonymizationPolicy): number {
    if (policy === undefined) return 0.5;

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
   * Dispose of resources
   */
  dispose(): Promise<void> {
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
 * Create an Inference Server NER model
 */
export function createInferenceServerNERModel(
  config: InferenceServerNERModelConfig
): InferenceServerNERModel {
  return new InferenceServerNERModel(config);
}

