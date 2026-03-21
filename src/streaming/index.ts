/**
 * Streaming Anonymization Module
 * Node.js/Bun only — not available in browser builds.
 */

export { AnonymizerStream } from "./anonymizer-stream.js";
export { createAnonymizerStream } from "./stream-factory.js";
export { SentenceBuffer, resolveBufferConfig } from "./sentence-buffer.js";
export type {
  StreamConfig,
  SentenceBufferConfig,
  StreamChunkEvent,
  StreamFinishEvent,
  FlushResult,
  ResolvedBufferConfig,
} from "./types.js";
