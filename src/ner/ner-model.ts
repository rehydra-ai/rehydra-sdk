/**
 * NER Model Wrapper
 * ONNX Runtime integration for Named Entity Recognition
 * Supports both onnxruntime-node and onnxruntime-web
 */

import {
  loadRuntime,
  getRuntimeType,
  type OrtRuntime,
  type OrtSessionOptions,
} from "#onnx-runtime";
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
import { getStorageProvider, isBrowser } from "#storage";

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
  /** ONNX session options for performance tuning */
  sessionOptions?: OrtSessionOptions;
  /**
   * Enable case-insensitive fallback pass for detecting lowercase names.
   * Runs a second NER pass on title-cased text and merges new detections.
   * @default false
   */
  caseFallback?: boolean;
  /**
   * Confidence penalty multiplier for case-fallback detections (0.0 - 1.0).
   * Applied as: confidence * caseFallbackPenalty
   * @default 0.85
   */
  caseFallbackPenalty?: number;
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
 * Builds optimized ONNX session options based on runtime environment
 * @param runtimeType - The detected ONNX runtime type ('node' or 'web')
 * @param customOptions - User-provided options that override defaults
 */
function buildSessionOptions(
  runtimeType: "node" | "web" | null,
  customOptions?: OrtSessionOptions
): OrtSessionOptions {
  const defaults: OrtSessionOptions = {
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    intraOpNumThreads: 4,
    interOpNumThreads: 1,
  };

  // Add execution providers based on environment
  if (runtimeType === "web") {
    // WebGPU (if available) with WASM fallback for browsers
    defaults.executionProviders = ["webgpu", "wasm"];
  }
  // For Node.js, no explicit execution providers needed (defaults to CPU)

  // Merge with custom options (custom options override defaults)
  return { ...defaults, ...customOptions };
}

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

    // Build optimized session options based on runtime and user config
    const runtimeType = getRuntimeType();
    const sessionOptions = buildSessionOptions(
      runtimeType,
      this.config.sessionOptions
    );

    // Load ONNX model
    // In browsers, we need to load the model as ArrayBuffer since file paths don't work
    // onnxruntime-web accepts ArrayBuffer/Uint8Array, while onnxruntime-node accepts file paths
    if (isBrowser()) {
      const storage = await getStorageProvider();
      const modelData = await storage.readFile(this.config.modelPath);
      // onnxruntime-web accepts Uint8Array directly
      this.session = await this.ort.InferenceSession.create(
        modelData,
        sessionOptions
      );
    } else {
      // In Node.js, we can use the file path directly
      this.session = await this.ort.InferenceSession.create(
        this.config.modelPath,
        sessionOptions
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
   * Runs a full NER pass: tokenize into overlapping windows, infer per
   * window, decode BIO tags, and reconcile window results.
   * @param inputText - Text to tokenize and feed to the model
   * @param originalText - Original text used for extracting entity text (may differ in casing)
   */
  private async runNERPass(
    inputText: string,
    originalText: string,
    minConfidence: number
  ): Promise<SpanMatch[]> {
    // Tokenize into overlapping model-sized windows so inputs longer than
    // maxLength tokens are fully processed instead of silently truncated
    const windows = this.tokenizer!.tokenizeWindows(inputText);

    const spans: SpanMatch[] = [];
    for (const window of windows) {
      // Run inference
      const { labels, confidences } = await this.runInference(window);

      // Decode BIO tags using original text for entity text extraction
      // (offsets are identical since casing doesn't change string length)
      const rawEntities = decodeBIOTags(
        window.tokens,
        labels,
        confidences,
        originalText
      );

      // Keep only entities anchored in this window's core range; the
      // overlap margins are context for the model, and entities starting
      // there belong to a neighboring window
      const anchored = rawEntities.filter(
        (e) => e.start >= window.coreCharStart && e.start < window.coreCharEnd
      );

      // Convert to SpanMatch format with confidence filtering
      spans.push(...convertToSpanMatches(anchored, minConfidence));
    }

    return spans;
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

    const minConfidence = this.getMinConfidence(policy);

    // Primary NER pass on original text
    let spans = await this.runNERPass(text, text, minConfidence);

    // Case fallback: run a second pass on title-cased text to catch lowercase names
    const caseFallback = this.config.caseFallback ?? false;
    if (caseFallback) {
      const titleCased = titleCaseWords(text);
      if (titleCased !== text) {
        const penalty = this.config.caseFallbackPenalty ?? 0.85;
        const fallbackSpans = await this.runNERPass(titleCased, text, minConfidence);

        // Merge only non-overlapping fallback detections with a confidence penalty
        for (const fallback of fallbackSpans) {
          const overlaps = spans.some(
            (primary) => primary.start < fallback.end && fallback.start < primary.end
          );
          if (!overlaps) {
            spans.push({
              ...fallback,
              confidence: fallback.confidence * penalty,
            });
          }
        }
      }
    }

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
 * Common function words / stopwords that should stay lowercase during case
 * fallback so the NER model can still use contrastive casing as a signal.
 * Only lowercase words NOT in this set get capitalized.
 */
const CASE_FALLBACK_STOPWORDS = new Set([
  // articles
  "a", "an", "the",
  // pronouns
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what",
  // prepositions
  "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "up", "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "over", "out", "off",
  "against", "along", "around", "among", "without", "within",
  // conjunctions
  "and", "but", "or", "nor", "so", "yet", "both", "either",
  "neither", "not", "than", "when", "while", "if", "then",
  "because", "since", "although", "though", "unless", "until",
  // common verbs / auxiliaries
  "is", "am", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing",
  "will", "would", "shall", "should",
  "can", "could", "may", "might", "must",
  "need", "dare", "ought",
  "get", "got", "gets", "getting",
  "let", "say", "said", "says",
  "go", "goes", "went", "going", "gone",
  "come", "comes", "came", "coming",
  "make", "makes", "made", "making",
  "take", "takes", "took", "taken", "taking",
  "give", "gives", "gave", "given", "giving",
  "tell", "tells", "told", "telling",
  "know", "knows", "knew", "known", "knowing",
  "think", "thinks", "thought", "thinking",
  "see", "sees", "saw", "seen", "seeing",
  "want", "wants", "wanted", "wanting",
  "look", "looks", "looked", "looking",
  "use", "uses", "used", "using",
  "find", "finds", "found", "finding",
  "put", "puts", "putting",
  "try", "tries", "tried", "trying",
  "ask", "asks", "asked", "asking",
  "work", "works", "worked", "working",
  "seem", "seems", "seemed", "seeming",
  "feel", "feels", "felt", "feeling",
  "leave", "leaves", "left", "leaving",
  "call", "calls", "called", "calling",
  "keep", "keeps", "kept", "keeping",
  "set", "sets", "setting",
  "show", "shows", "showed", "shown", "showing",
  "turn", "turns", "turned", "turning",
  "move", "moves", "moved", "moving",
  "play", "plays", "played", "playing",
  "run", "runs", "ran", "running",
  "hold", "holds", "held", "holding",
  "bring", "brings", "brought", "bringing",
  "happen", "happens", "happened", "happening",
  "write", "writes", "wrote", "written", "writing",
  "sit", "sits", "sat", "sitting",
  "stand", "stands", "stood", "standing",
  "lose", "loses", "lost", "losing",
  "pay", "pays", "paid", "paying",
  "meet", "meets", "met", "meeting",
  "send", "sends", "sent", "sending",
  "read", "reads", "reading",
  "spend", "spends", "spent", "spending",
  "grow", "grows", "grew", "grown", "growing",
  "open", "opens", "opened", "opening",
  "walk", "walks", "walked", "walking",
  "win", "wins", "won", "winning",
  "teach", "teaches", "taught", "teaching",
  "buy", "buys", "bought", "buying",
  "speak", "speaks", "spoke", "spoken", "speaking",
  // adverbs / misc
  "now", "just", "also", "very", "often", "still", "already",
  "how", "all", "each", "every", "any", "few", "more", "most",
  "some", "such", "no", "only", "same", "other", "new", "old",
  "right", "well", "back", "even", "too", "here", "there",
  "where", "why", "again", "once", "never", "always",
  "much", "many", "own", "quite", "really",
  "way", "thing", "things", "part", "place", "case", "point",
  "time", "times", "day", "days", "year", "years",
  "man", "men", "woman", "women", "child", "children",
  "world", "life", "hand", "long", "little", "big",
  "good", "bad", "great", "small", "large", "high", "low",
  "first", "last", "next", "bit", "lot", "kind", "sort",
  "enough", "able", "away", "sure", "else",
  // contractions / fragments
  "don", "doesn", "didn", "won", "wouldn", "shouldn",
  "couldn", "isn", "aren", "wasn", "weren", "hasn", "haven",
  "hadn", "ll", "ve", "re", "nt",
  // German stopwords (common in multilingual contexts)
  "der", "die", "das", "ein", "eine", "einer",
  "und", "oder", "aber", "denn", "weil",
  "ist", "sind", "war", "waren", "bin", "bist",
  "hat", "haben", "hatte", "hatten",
  "wird", "werden", "wurde", "wurden",
  "kann", "konnte", "soll", "sollte", "muss", "musste",
  "nicht", "kein", "keine", "keiner",
  "ich", "du", "er", "sie", "es", "wir", "ihr",
  "mein", "dein", "sein", "unser", "euer",
  "mir", "dir", "ihm", "uns", "euch", "ihnen",
  "auf", "aus", "bei", "mit", "nach", "von", "zu", "vor",
  "den", "dem", "des",
  "als", "wie", "wenn", "dann", "doch", "noch", "schon",
  "auch", "nur", "sehr", "mehr", "jetzt", "hier", "da",
  "mal", "bitte", "etwas", "was", "wer", "wo",
  "ja", "nein", "okay",
  // French stopwords
  "le", "la", "les", "un", "une", "des",
  "et", "ou", "mais", "donc", "car",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "mon", "ton", "son", "notre", "votre", "leur",
  "ce", "cette", "ces",
  "est", "sont", "suis", "es", "sommes",
  "pas", "ne", "plus", "que", "qui",
  "dans", "sur", "sous", "avec", "pour", "par", "entre",
  "au", "aux", "du",
  "tout", "tous", "bien", "peu", "trop",
  // Spanish stopwords
  "el", "los", "las", "uno", "una", "unos", "unas",
  "yo", "nos", "su", "sus", "mi", "mis", "tu", "tus",
  "es", "son", "fue", "era", "hay",
  "en", "con", "sin", "sobre", "entre", "hacia",
  "del", "al",
  "no", "si", "muy", "mas", "menos",
  "que", "como", "donde", "cuando", "porque",
]);

/**
 * Capitalizes the first letter of each word for case-insensitive NER fallback.
 * Only capitalizes words NOT in the stopword list, so the NER model retains
 * contrastive casing signal (lowercase function words vs. capitalized candidates).
 * Preserves string length so character offsets remain valid.
 */
function titleCaseWords(text: string): string {
  return text.replace(/\b([a-z][a-z]*)/g, (word) => {
    if (CASE_FALLBACK_STOPWORDS.has(word)) {
      return word;
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
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
    sessionOptions: config.sessionOptions,
    caseFallback: config.caseFallback,
    caseFallbackPenalty: config.caseFallbackPenalty,
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
