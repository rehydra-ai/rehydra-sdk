/**
 * Anonymizer Session Implementation
 * Session-bound wrapper for automatic PII map storage
 */

import type {
  AnonymizationResult,
  AnonymizationPolicy,
} from "../types/index.js";
import type { KeyProvider } from "../crypto/index.js";
import { decryptPIIMap } from "../crypto/index.js";
import { rehydrate as rehydrateText } from "../pipeline/tagger.js";
import type {
  AnonymizerSession,
  PIIStorageProvider,
  StoredPIIMap,
} from "./types.js";

/**
 * Interface for the parent Anonymizer (to avoid circular dependency)
 */
export interface IAnonymizer {
  anonymize(
    text: string,
    locale?: string,
    policy?: Partial<AnonymizationPolicy>
  ): Promise<AnonymizationResult>;
}

/**
 * Session implementation that wraps an Anonymizer with automatic storage
 */
export class AnonymizerSessionImpl implements AnonymizerSession {
  readonly sessionId: string;

  constructor(
    private readonly anonymizer: IAnonymizer,
    sessionId: string,
    private readonly storage: PIIStorageProvider,
    private readonly keyProvider: KeyProvider
  ) {
    this.sessionId = sessionId;
  }

  async anonymize(
    text: string,
    locale?: string,
    policy?: Partial<AnonymizationPolicy>
  ): Promise<AnonymizationResult> {
    // Call the parent anonymizer
    const result = await this.anonymizer.anonymize(text, locale, policy);

    // Auto-save to storage
    await this.storage.save(this.sessionId, result.piiMap, {
      createdAt: Date.now(),
      entityCounts: result.stats.countsByType,
      modelVersion: result.stats.modelVersion,
    });

    return result;
  }

  async rehydrate(text: string): Promise<string> {
    // Load from storage
    const stored = await this.storage.load(this.sessionId);
    if (stored === null) {
      throw new Error(
        `No PII map found for session: ${this.sessionId}. ` +
          `Make sure to call anonymize() before rehydrate().`
      );
    }

    // Decrypt the PII map
    const key = await this.keyProvider.getKey();
    const piiMap = await decryptPIIMap(stored.piiMap, key);

    // Rehydrate the text
    return rehydrateText(text, piiMap);
  }

  async load(): Promise<StoredPIIMap | null> {
    return this.storage.load(this.sessionId);
  }

  async delete(): Promise<boolean> {
    return this.storage.delete(this.sessionId);
  }

  async exists(): Promise<boolean> {
    return this.storage.exists(this.sessionId);
  }
}

