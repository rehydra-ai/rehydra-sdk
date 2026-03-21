/**
 * Stream Factory
 * Creates configured AnonymizerStream instances
 */

import {
  createAnonymizer,
  type AnonymizerConfig,
} from "../core/anonymizer.js";
import { decryptPIIMap } from "../crypto/index.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
import { AnonymizerStream } from "./anonymizer-stream.js";
import type { StreamConfig } from "./types.js";

/**
 * Creates a streaming anonymizer that processes text chunk-by-chunk.
 *
 * @example
 * ```typescript
 * // Basic streaming with NER
 * const stream = await createAnonymizerStream({
 *   anonymizer: { ner: { mode: 'quantized' } },
 * });
 *
 * createReadStream('input.txt')
 *   .pipe(stream)
 *   .pipe(createWriteStream('anonymized.txt'));
 * ```
 *
 * @example
 * ```typescript
 * // Low-latency mode for LLM token streams
 * const stream = await createAnonymizerStream({
 *   buffer: { lowLatency: true },
 *   sessionId: 'chat-123',
 *   piiStorageProvider: storage,
 *   keyProvider: keyProvider,
 * });
 *
 * llmTokenStream.pipe(stream).on('data', (chunk) => {
 *   ws.send(chunk.toString());
 * });
 * ```
 */
export async function createAnonymizerStream(
  config: StreamConfig = {},
): Promise<AnonymizerStream> {
  // In low-latency mode, force NER disabled for minimal latency
  let anonymizerConfig: AnonymizerConfig | undefined = config.anonymizer;
  if (config.buffer?.lowLatency === true) {
    anonymizerConfig = {
      ...anonymizerConfig,
      ner: { mode: "disabled" },
    };
  }

  // Ensure the anonymizer uses the same key provider as the stream
  // so that PII maps encrypted by the anonymizer can be decrypted by the stream.
  if (config.keyProvider) {
    anonymizerConfig = {
      ...anonymizerConfig,
      keyProvider: config.keyProvider,
    };
  }

  // Create and initialize the anonymizer
  const anonymizer = createAnonymizer(anonymizerConfig);
  await anonymizer.initialize();

  // Load existing PII map from session storage if available
  let initialPiiMap: RawPIIMap | undefined;
  if (config.sessionId !== undefined && config.sessionId !== "" && config.piiStorageProvider !== undefined && config.keyProvider !== undefined) {
    const existing = await config.piiStorageProvider.load(config.sessionId);
    if (existing !== null) {
      const key = await config.keyProvider.getKey();
      initialPiiMap = await decryptPIIMap(existing.piiMap, key);
    }
  }

  return new AnonymizerStream(anonymizer, config, initialPiiMap);
}
