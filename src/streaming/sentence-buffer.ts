/**
 * Sentence Buffer
 * Accumulates incoming text and flushes complete sentences for anonymization,
 * keeping an overlap region for NER context at chunk boundaries.
 */

import type { AnonymizationPolicy } from "../types/index.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
import type { KeyProvider } from "../crypto/index.js";
import { decryptPIIMap } from "../crypto/index.js";
import type { IAnonymizer } from "../storage/session.js";
import type {
  SentenceBufferConfig,
  ResolvedBufferConfig,
  FlushResult,
} from "./types.js";

const DEFAULT_SENTENCE_BOUNDARY = /[.!?]\s+|\n{2,}/;

const DEFAULT_CONFIG: ResolvedBufferConfig = {
  overlapChars: 100,
  maxBufferSize: 8192,
  minBufferSize: 50,
  lowLatency: false,
  sentenceBoundary: DEFAULT_SENTENCE_BOUNDARY,
};

const LOW_LATENCY_CONFIG: Partial<ResolvedBufferConfig> = {
  overlapChars: 50,
  maxBufferSize: 512,
  minBufferSize: 20,
};

/**
 * Resolves user config with defaults
 */
export function resolveBufferConfig(
  config?: SentenceBufferConfig,
): ResolvedBufferConfig {
  const base = config?.lowLatency === true
    ? { ...DEFAULT_CONFIG, ...LOW_LATENCY_CONFIG, lowLatency: true }
    : { ...DEFAULT_CONFIG };

  return {
    overlapChars: config?.overlapChars ?? base.overlapChars,
    maxBufferSize: config?.maxBufferSize ?? base.maxBufferSize,
    minBufferSize: config?.minBufferSize ?? base.minBufferSize,
    lowLatency: config?.lowLatency ?? base.lowLatency,
    sentenceBoundary: config?.sentenceBoundary ?? base.sentenceBoundary,
  };
}

/**
 * SentenceBuffer accumulates text and flushes at sentence boundaries,
 * maintaining an overlap region for NER context across boundaries.
 */
export class SentenceBuffer {
  private buffer = "";
  private overlapSuffix = "";
  private cumulativePiiMap: RawPIIMap = new Map();
  private totalEntities = 0;

  private readonly config: ResolvedBufferConfig;
  private readonly anonymizer: IAnonymizer;
  private readonly keyProvider: KeyProvider | null;
  private readonly locale?: string;
  private readonly policy?: Partial<AnonymizationPolicy>;

  constructor(
    anonymizer: IAnonymizer,
    config?: SentenceBufferConfig,
    options?: {
      keyProvider?: KeyProvider;
      locale?: string;
      policy?: Partial<AnonymizationPolicy>;
      initialPiiMap?: RawPIIMap;
    },
  ) {
    this.anonymizer = anonymizer;
    this.config = resolveBufferConfig(config);
    this.keyProvider = options?.keyProvider ?? null;
    this.locale = options?.locale;
    this.policy = options?.policy;

    if (options?.initialPiiMap) {
      this.cumulativePiiMap = new Map(options.initialPiiMap);
    }
  }

  /**
   * Append a chunk of text. Returns flush results if sentence boundaries
   * were found and text was anonymized, or an empty array if buffering.
   */
  async append(chunk: string): Promise<FlushResult[]> {
    if (chunk.length === 0) return [];

    this.buffer += chunk;

    if (this.buffer.length < this.config.minBufferSize) {
      return [];
    }

    return this.flushAvailable();
  }

  /**
   * Flush all remaining buffered text (called on stream end).
   */
  async flush(): Promise<FlushResult[]> {
    if (this.buffer.length === 0) {
      return [];
    }

    const result = await this.processSegment(this.buffer, true);
    this.buffer = "";
    this.overlapSuffix = "";
    return result ? [result] : [];
  }

  /**
   * Get the cumulative PII map built across all flushes.
   */
  getCumulativePiiMap(): RawPIIMap {
    return new Map(this.cumulativePiiMap);
  }

  /**
   * Get total entity count across all flushes.
   */
  getTotalEntities(): number {
    return this.totalEntities;
  }

  /**
   * Find and flush all available sentence-delimited segments from the buffer.
   */
  private async flushAvailable(): Promise<FlushResult[]> {
    const results: FlushResult[] = [];

    while (this.buffer.length >= this.config.minBufferSize) {
      const boundaryIndex = this.findLastBoundary();

      if (boundaryIndex === -1) {
        // No boundary found
        if (this.buffer.length > this.config.maxBufferSize) {
          // Force flush at maxBufferSize
          const segment = this.buffer.slice(0, this.config.maxBufferSize);
          this.buffer = this.buffer.slice(this.config.maxBufferSize);
          const result = await this.processSegment(segment, false);
          if (result) results.push(result);
        } else {
          // Wait for more data
          break;
        }
      } else {
        // Flush up to the boundary
        const segment = this.buffer.slice(0, boundaryIndex);
        this.buffer = this.buffer.slice(boundaryIndex);
        const result = await this.processSegment(segment, false);
        if (result) results.push(result);
      }
    }

    return results;
  }

  /**
   * Find the last sentence boundary position in the buffer.
   * Returns the index after the boundary (split point), or -1 if none found.
   */
  private findLastBoundary(): number {
    const regex = new RegExp(this.config.sentenceBoundary.source, "g");
    let lastIndex = -1;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(this.buffer)) !== null) {
      // Split point is after the boundary match
      lastIndex = match.index + match[0].length;
    }

    return lastIndex;
  }

  /**
   * Process a segment of text: prepend overlap, anonymize, extract new output.
   */
  private async processSegment(
    segment: string,
    isFinal: boolean,
  ): Promise<FlushResult | null> {
    if (segment.length === 0) return null;

    // Build context text with overlap for NER boundary detection
    const contextText = this.overlapSuffix + segment;
    const overlapLength = this.overlapSuffix.length;

    // Anonymize with cumulative PII map for ID consistency
    const result = await this.anonymizer.anonymize(
      contextText,
      this.locale,
      this.policy,
      this.cumulativePiiMap,
    );

    // Decrypt the PII map from the result to merge into cumulative map
    if (result.piiMap && this.keyProvider) {
      const key = await this.keyProvider.getKey();
      const decrypted = await decryptPIIMap(result.piiMap, key);
      for (const [k, v] of decrypted) {
        this.cumulativePiiMap.set(k, v);
      }
    }

    // Extract only the new (non-overlap) portion of the anonymized text
    const newOutput = this.extractNewOutput(
      contextText,
      result.anonymizedText,
      result.entities,
      overlapLength,
    );

    // Update overlap suffix for next segment
    if (!isFinal) {
      this.overlapSuffix = segment.slice(
        Math.max(0, segment.length - this.config.overlapChars),
      );
    }

    // Filter entities to only those in the new portion
    const newEntities = result.entities.filter((e) => e.start >= overlapLength);
    // Adjust entity offsets to be relative to the segment (not contextText)
    const adjustedEntities = newEntities.map((e) => ({
      ...e,
      start: e.start - overlapLength,
      end: e.end - overlapLength,
    }));

    this.totalEntities += adjustedEntities.length;

    return {
      anonymizedText: newOutput,
      entities: adjustedEntities,
    };
  }

  /**
   * Extract the new (non-overlap) portion from the anonymized text.
   *
   * The anonymized text covers `overlapSuffix + segment`. We need to find
   * the split point in the anonymized text that corresponds to the original
   * offset where the new content begins.
   *
   * We walk through the original text and anonymized text simultaneously,
   * advancing past PII tags in the anonymized text while tracking the
   * corresponding position in the original text.
   */
  private extractNewOutput(
    originalContext: string,
    anonymizedText: string,
    entities: Omit<import("../types/index.js").DetectedEntity, "original">[],
    overlapLength: number,
  ): string {
    if (overlapLength === 0) {
      return anonymizedText;
    }

    // Build a map of original positions to anonymized positions.
    // Entities replace spans in the original text with PII tags of different lengths.
    // We need to find where overlapLength in original space maps to in anonymized space.

    // Sort entities by start position
    const sortedEntities = [...entities].sort((a, b) => a.start - b.start);

    // Walk through, tracking offset shift caused by tag replacements
    let originalPos = 0;
    let anonymizedPos = 0;

    for (const entity of sortedEntities) {
      if (entity.start >= overlapLength) {
        // This entity is fully in the new portion — stop here
        break;
      }

      // Advance to this entity's start
      const gap = entity.start - originalPos;
      anonymizedPos += gap;
      originalPos = entity.start;

      // The entity's original span length
      const originalSpanLength = entity.end - entity.start;

      // Find the tag in the anonymized text at this position
      // Tags look like: <PII type="TYPE" id="N"/>
      const tagStart = anonymizedPos;
      const tagEnd = anonymizedText.indexOf("/>", tagStart);
      const tagLength =
        tagEnd !== -1 ? tagEnd + 2 - tagStart : originalSpanLength;

      if (entity.end <= overlapLength) {
        // Entity is fully within the overlap — skip entirely
        originalPos = entity.end;
        anonymizedPos = tagStart + tagLength;
      } else {
        // Entity spans the boundary — it belongs to overlap (already emitted)
        originalPos = entity.end;
        anonymizedPos = tagStart + tagLength;
      }
    }

    // Advance remaining gap to the overlap boundary
    const remainingGap = overlapLength - originalPos;
    anonymizedPos += remainingGap;

    return anonymizedText.slice(anonymizedPos);
  }
}
