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
import {
  createTokenWindows,
  mergeWindowSpans,
  validateWindowConfig,
  windowTokenBudget,
} from "./token-window.js";
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
  /** Number of content tokens shared by adjacent long-input windows. */
  windowOverlapTokens: number;
  /**
   * Maximum number of inference windows per input. Inputs that tokenize to
   * more windows are scanned only up to this bound (onWindowCap fires once per
   * capped inference pass — so twice for one input when caseFallback runs a
   * second pass). Guards callers that feed very large opaque payloads
   * (multi-megabyte base64 attachments) from unbounded inference cost.
   * @default undefined (unbounded — full coverage)
   */
  maxWindowsPerInput?: number;
  /**
   * Called when an input exceeds maxWindowsPerInput and its tail is left
   * unscanned. Callers should log/meter this — it is a coverage reduction,
   * not an error. When absent, a console warning is emitted instead.
   * `inputLength` is the full input character count; the true total window
   * count is not reported because tokenization stops at the cap (computing
   * it would require tokenizing the whole input, the cost the cap avoids).
   */
  onWindowCap?: (info: { scannedWindows: number; inputLength: number }) => void;
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
  /**
   * True when the input exceeded maxWindowsPerInput and its tail was left
   * unscanned by NER. Callers enforcing a fail-closed policy should treat
   * this as incomplete coverage.
   */
  truncated: boolean;
  /**
   * Number of leading input characters NER actually scanned — the end offset
   * of the last content token. When not truncated this covers the whole input
   * except any trailing whitespace/punctuation past the last token; when
   * truncated, a caller can cut the input at this offset to keep only the
   * fully-scanned portion.
   */
  coverageChars: number;
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
   * Runs a single NER pass: tokenize, infer, decode BIO tags.
   * @param inputText - Text to tokenize and feed to the model
   * @param originalText - Original text used for extracting entity text (may differ in casing)
   */
  private async runNERPass(
    inputText: string,
    originalText: string,
    minConfidence: number
  ): Promise<{ spans: SpanMatch[]; truncated: boolean; coverageChars: number }> {
    // Tokenize without per-model truncation so windows retain global
    // character offsets. Bound the token count to what maxWindowsPerInput
    // windows can consume: only the leading windows are ever scanned, so
    // materializing a multi-million-token array for a multi-MB value would
    // be pure waste (and a memory hazard). maxTokens undefined = unbounded.
    const maxTokens =
      this.config.maxWindowsPerInput === undefined
        ? undefined
        : windowTokenBudget(
            this.config.maxLength,
            this.config.windowOverlapTokens,
            this.config.maxWindowsPerInput,
          );
    const tokenization = this.tokenizer!.tokenize(inputText, { truncate: false, maxTokens });
    const windows = createTokenWindows(
      tokenization,
      this.config.maxLength,
      this.config.windowOverlapTokens,
    );
    if (tokenization.truncated) {
      const info = { scannedWindows: windows.length, inputLength: inputText.length };
      if (this.config.onWindowCap) {
        this.config.onWindowCap(info);
      } else {
        console.warn(
          `[rehydra] NER input (${info.inputLength} chars) exceeds the window budget; scanning only the first ${info.scannedWindows} windows (maxWindowsPerInput)`,
        );
      }
    }
    const spans: SpanMatch[] = [];

    for (const window of windows) {
      const { labels, confidences } = await this.runInference(window);
      const rawEntities = decodeBIOTags(
        window.tokens,
        labels,
        confidences,
        originalText,
      );
      spans.push(...convertToSpanMatches(rawEntities, minConfidence));
    }

    // Chars of input actually scanned = end of the last content token (the
    // token before the trailing SEP). When there is no content token, coverage
    // is 0 if we truncated (nothing was scanned — a caller must not treat this
    // as "all covered") and the full length otherwise (empty/whitespace input).
    const lastContentToken = tokenization.tokens[tokenization.tokens.length - 2];
    const hasContentToken = lastContentToken !== undefined && !lastContentToken.isSpecial;
    const coverageChars = hasContentToken
      ? lastContentToken.end
      : tokenization.truncated
        ? 0
        : inputText.length;

    return {
      spans: mergeWindowSpans(spans, originalText),
      truncated: tokenization.truncated,
      coverageChars,
    };
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
    const primary = await this.runNERPass(text, text, minConfidence);
    let spans = primary.spans;
    let truncated = primary.truncated;
    // A caller cutting at coverageChars must stay within what BOTH passes
    // scanned, so take the smaller offset. (Title-casing preserves length but
    // changes tokenization, so the fallback pass can cap at a different point.)
    let coverageChars = primary.coverageChars;

    // Case fallback: run a second pass on title-cased text to catch lowercase names
    const caseFallback = this.config.caseFallback ?? false;
    if (caseFallback) {
      const titleCased = titleCaseWords(text);
      if (titleCased !== text) {
        const penalty = this.config.caseFallbackPenalty ?? 0.85;
        const fallback = await this.runNERPass(titleCased, text, minConfidence);
        truncated = truncated || fallback.truncated;
        coverageChars = Math.min(coverageChars, fallback.coverageChars);

        // Merge only non-overlapping fallback detections with a confidence penalty
        for (const span of fallback.spans) {
          const overlaps = spans.some(
            (existing) => existing.start < span.end && span.start < existing.end
          );
          if (!overlaps) {
            spans.push({
              ...span,
              confidence: span.confidence * penalty,
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
      truncated,
      coverageChars,
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
  const maxLength = config.maxLength ?? 512;
  const fullConfig: NERModelConfig = {
    modelPath: config.modelPath,
    vocabPath: config.vocabPath,
    labelMap: config.labelMap ?? DEFAULT_LABEL_MAP,
    maxLength,
    windowOverlapTokens: config.windowOverlapTokens
      ?? Math.min(64, Math.max(0, Math.floor((maxLength - 2) / 4))),
    maxWindowsPerInput: config.maxWindowsPerInput,
    onWindowCap: config.onWindowCap,
    doLowerCase: config.doLowerCase ?? false, // XLM-RoBERTa is cased
    modelVersion: config.modelVersion ?? "1.0.0",
    sessionOptions: config.sessionOptions,
    caseFallback: config.caseFallback,
    caseFallbackPenalty: config.caseFallbackPenalty,
  };

  // Fail fast on bad windowing config instead of on the first predict().
  validateWindowConfig(
    fullConfig.maxLength,
    fullConfig.windowOverlapTokens,
    fullConfig.maxWindowsPerInput,
  );

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
      truncated: false,
      coverageChars: _text.length,
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
