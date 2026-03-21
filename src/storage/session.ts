/**
 * Anonymizer Session Implementation (Node.js)
 * Extends the base session with streaming support (requires node:stream).
 */

export { type IAnonymizer } from "./session-base.js";
import { AnonymizerSessionImpl as BaseSessionImpl } from "./session-base.js";
import type { KeyProvider } from "../crypto/index.js";
import { decryptPIIMap } from "../crypto/index.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
import type { PIIStorageProvider } from "./types.js";
import { AnonymizerStream } from "../streaming/anonymizer-stream.js";
import type { StreamConfig } from "../streaming/types.js";
import type { IAnonymizer } from "./session-base.js";

/**
 * Node.js session implementation with streaming support
 */
export class AnonymizerSessionImpl extends BaseSessionImpl {
  constructor(
    anonymizer: IAnonymizer,
    sessionId: string,
    storage: PIIStorageProvider,
    keyProvider: KeyProvider
  ) {
    super(anonymizer, sessionId, storage, keyProvider);
  }

  async createStream(config?: Partial<StreamConfig>): Promise<AnonymizerStream> {
    // Load existing PII map to seed the stream for ID continuity
    let initialPiiMap: RawPIIMap | undefined;
    const existing = await this.storage.load(this.sessionId);
    if (existing !== null) {
      const key = await this.keyProvider.getKey();
      initialPiiMap = await decryptPIIMap(existing.piiMap, key);
    }

    return new AnonymizerStream(
      this.anonymizer,
      {
        ...config,
        sessionId: this.sessionId,
        piiStorageProvider: this.storage,
        keyProvider: this.keyProvider,
      },
      initialPiiMap,
    );
  }
}
