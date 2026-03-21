/**
 * Streaming Anonymization Types
 */

import type { TransformOptions } from "node:stream";
import type { AnonymizerConfig } from "../core/anonymizer.js";
import type {
  AnonymizationPolicy,
  DetectedEntity,
  EncryptedPIIMap,
} from "../types/index.js";
import type { KeyProvider } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";

/**
 * Configuration for the streaming anonymizer
 */
export interface StreamConfig {
  /** Base anonymizer config */
  anonymizer?: AnonymizerConfig;

  /** Policy override for all chunks */
  policy?: Partial<AnonymizationPolicy>;

  /** Locale hint (e.g., 'de-DE', 'en-US') */
  locale?: string;

  /** Sentence buffer configuration */
  buffer?: SentenceBufferConfig;

  /** Session ID for cross-chunk ID persistence and storage */
  sessionId?: string;

  /** Storage provider (required if sessionId is set) */
  piiStorageProvider?: PIIStorageProvider;

  /** Key provider (required if sessionId is set) */
  keyProvider?: KeyProvider;

  /**
   * Interval in milliseconds for saving the PII map to storage during streaming.
   * When set, saves at most once per interval (in addition to the final save on flush).
   * Useful for crash recovery on long streams.
   * @default undefined (only save on stream end)
   */
  saveIntervalMs?: number;

  /** Node.js Transform stream options (highWaterMark, etc.) */
  streamOptions?: TransformOptions;

  /** Callback fired after each chunk is anonymized */
  onChunk?: (event: StreamChunkEvent) => void;

  /** Callback fired when the stream finishes */
  onFinish?: (event: StreamFinishEvent) => void;
}

/**
 * Sentence buffer configuration
 */
export interface SentenceBufferConfig {
  /**
   * Overlap size in characters for NER context window.
   * The overlap region from the previous chunk is re-processed
   * to catch entities that span boundaries.
   * @default 100
   */
  overlapChars?: number;

  /**
   * Maximum buffer size before forcing a flush.
   * Prevents unbounded memory growth if no sentence boundary is found.
   * @default 8192
   */
  maxBufferSize?: number;

  /**
   * Minimum characters to buffer before attempting sentence detection.
   * In low-latency mode this is automatically reduced.
   * @default 50
   */
  minBufferSize?: number;

  /**
   * Low-latency mode for LLM token streams.
   * - Reduces buffer sizes
   * - Disables NER (regex-only)
   * - Flushes more aggressively
   * @default false
   */
  lowLatency?: boolean;

  /**
   * Custom sentence boundary regex.
   * @default /[.!?]\s+|[\n]{2,}/
   */
  sentenceBoundary?: RegExp;
}

/**
 * Event emitted after each chunk is processed
 */
export interface StreamChunkEvent {
  /** Anonymized text for this chunk */
  anonymizedText: string;
  /** Entities detected in this chunk */
  entities: Omit<DetectedEntity, "original">[];
  /** Cumulative entity count */
  totalEntities: number;
  /** Processing time for this chunk in ms */
  processingTimeMs: number;
}

/**
 * Event emitted when the stream finishes
 */
export interface StreamFinishEvent {
  /** Total entities across all chunks */
  totalEntities: number;
  /** Final encrypted PII map (if pseudonymize mode) */
  piiMap?: EncryptedPIIMap;
  /** Total processing time in ms */
  totalProcessingTimeMs: number;
}

/**
 * Result of a single buffer flush
 */
export interface FlushResult {
  /** Anonymized text for the new (non-overlap) portion */
  anonymizedText: string;
  /** Entities detected in this flush */
  entities: Omit<DetectedEntity, "original">[];
}

/**
 * Resolved buffer configuration with defaults applied
 */
export interface ResolvedBufferConfig {
  overlapChars: number;
  maxBufferSize: number;
  minBufferSize: number;
  lowLatency: boolean;
  sentenceBoundary: RegExp;
}
