/**
 * Anonymizer Stream
 * Node.js Transform stream that anonymizes text chunk-by-chunk
 * using sentence buffering for NER context.
 */

import { Transform, type TransformCallback } from "node:stream";
import type { RawPIIMap } from "../pipeline/tagger.js";
import { SentenceBuffer } from "./sentence-buffer.js";
import type { StreamConfig, StreamChunkEvent, StreamFinishEvent } from "./types.js";
import type { IAnonymizer } from "../storage/session.js";
import type { KeyProvider } from "../crypto/index.js";
import { encryptPIIMap } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";

/**
 * Transform stream that anonymizes text passing through it.
 *
 * Uses a SentenceBuffer to accumulate text and flush at sentence
 * boundaries, maintaining overlap for NER context.
 *
 * @example
 * ```typescript
 * const stream = await createAnonymizerStream({
 *   anonymizer: { ner: { mode: 'quantized' } },
 *   sessionId: 'chat-123',
 *   piiStorageProvider: storage,
 *   keyProvider: keyProvider,
 * });
 *
 * createReadStream('input.txt')
 *   .pipe(stream)
 *   .pipe(createWriteStream('anonymized.txt'));
 * ```
 */
export class AnonymizerStream extends Transform {
  private readonly sentenceBuffer: SentenceBuffer;
  private readonly keyProvider: KeyProvider | null;
  private readonly piiStorageProvider: PIIStorageProvider | null;
  private readonly sessionId: string | null;
  private readonly onChunkCallback?: (event: StreamChunkEvent) => void;
  private readonly onFinishCallback?: (event: StreamFinishEvent) => void;

  private readonly saveIntervalMs: number | null;
  private lastSaveTime = 0;

  private totalEntities = 0;
  private startTime = 0;
  private chunkCount = 0;

  constructor(
    anonymizer: IAnonymizer,
    config: StreamConfig,
    initialPiiMap?: RawPIIMap,
  ) {
    super({
      ...config.streamOptions,
      decodeStrings: true,
      encoding: "utf-8",
    });

    this.keyProvider = config.keyProvider ?? null;
    this.piiStorageProvider = config.piiStorageProvider ?? null;
    this.sessionId = config.sessionId ?? null;
    this.onChunkCallback = config.onChunk;
    this.onFinishCallback = config.onFinish;
    this.saveIntervalMs = config.saveIntervalMs ?? null;

    this.sentenceBuffer = new SentenceBuffer(anonymizer, config.buffer, {
      keyProvider: this.keyProvider ?? undefined,
      locale: config.locale,
      policy: config.policy,
      initialPiiMap,
    });
  }

  /**
   * Get the cumulative PII map built across all chunks.
   * Available after stream finishes.
   */
  getPiiMap(): RawPIIMap {
    return this.sentenceBuffer.getCumulativePiiMap();
  }

  /**
   * Get stream statistics.
   */
  get stats(): {
    totalEntities: number;
    chunksProcessed: number;
    totalProcessingTimeMs: number;
  } {
    return {
      totalEntities: this.totalEntities,
      chunksProcessed: this.chunkCount,
      totalProcessingTimeMs:
        this.startTime > 0 ? performance.now() - this.startTime : 0,
    };
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (this.startTime === 0) {
      this.startTime = performance.now();
    }

    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");

    this.processChunk(text)
      .then(() => callback())
      .catch((err: Error) => callback(err));
  }

  override _flush(callback: TransformCallback): void {
    this.processFlush()
      .then(() => callback())
      .catch((err: Error) => callback(err));
  }

  private async processChunk(text: string): Promise<void> {
    const chunkStart = performance.now();
    const results = await this.sentenceBuffer.append(text);

    for (const result of results) {
      this.chunkCount++;
      this.totalEntities += result.entities.length;
      this.push(result.anonymizedText);

      this.onChunkCallback?.({
        anonymizedText: result.anonymizedText,
        entities: result.entities,
        totalEntities: this.totalEntities,
        processingTimeMs: performance.now() - chunkStart,
      });
    }

    // Debounced save: save PII map at most once per saveIntervalMs
    if (this.saveIntervalMs !== null && results.length > 0) {
      await this.maybeSaveToStorage();
    }
  }

  private async maybeSaveToStorage(): Promise<void> {
    if (this.sessionId === null || this.piiStorageProvider === null || this.keyProvider === null) {
      return;
    }

    const now = performance.now();
    if (now - this.lastSaveTime < (this.saveIntervalMs ?? Infinity)) {
      return;
    }

    const piiMap = this.sentenceBuffer.getCumulativePiiMap();
    if (piiMap.size === 0) return;

    const key = await this.keyProvider.getKey();
    const encrypted = await encryptPIIMap(piiMap, key);
    await this.piiStorageProvider.save(this.sessionId, encrypted, {
      createdAt: Date.now(),
      entityCounts: this.buildEntityCounts(),
    });
    this.lastSaveTime = now;
  }

  private async processFlush(): Promise<void> {
    // Flush remaining buffer
    const results = await this.sentenceBuffer.flush();

    for (const result of results) {
      this.chunkCount++;
      this.totalEntities += result.entities.length;
      this.push(result.anonymizedText);

      this.onChunkCallback?.({
        anonymizedText: result.anonymizedText,
        entities: result.entities,
        totalEntities: this.totalEntities,
        processingTimeMs: performance.now() - this.startTime,
      });
    }

    // Save PII map to storage if session is configured
    if (this.sessionId !== null && this.piiStorageProvider !== null && this.keyProvider !== null) {
      const piiMap = this.sentenceBuffer.getCumulativePiiMap();
      if (piiMap.size > 0) {
        const key = await this.keyProvider.getKey();
        const encrypted = await encryptPIIMap(piiMap, key);
        await this.piiStorageProvider.save(this.sessionId, encrypted, {
          createdAt: Date.now(),
          entityCounts: this.buildEntityCounts(),
        });
      }
    }

    // Fire finish callback
    const totalTime = performance.now() - this.startTime;
    let finishPiiMap;
    if (this.keyProvider) {
      const piiMap = this.sentenceBuffer.getCumulativePiiMap();
      if (piiMap.size > 0) {
        const key = await this.keyProvider.getKey();
        finishPiiMap = await encryptPIIMap(piiMap, key);
      }
    }

    this.onFinishCallback?.({
      totalEntities: this.totalEntities,
      piiMap: finishPiiMap,
      totalProcessingTimeMs: totalTime,
    });
  }

  private buildEntityCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const key of this.sentenceBuffer.getCumulativePiiMap().keys()) {
      // Keys are in format "TYPE_ID" e.g. "EMAIL_1", "PERSON_2"
      const underscoreIdx = key.lastIndexOf("_");
      if (underscoreIdx !== -1) {
        const type = key.slice(0, underscoreIdx);
        counts[type] = (counts[type] ?? 0) + 1;
      }
    }
    return counts;
  }
}
