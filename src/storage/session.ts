/**
 * Anonymizer Session Implementation
 * Session-bound wrapper for automatic PII map storage
 */

import type {
  AnonymizationResult,
  AnonymizationPolicy,
} from "../types/index.js";
import type { KeyProvider } from "../crypto/index.js";
import { decryptPIIMap, encryptPIIMap } from "../crypto/index.js";
import { rehydrate as rehydrateText } from "../pipeline/tagger.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
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

    // Get the encryption key
    const key = await this.keyProvider.getKey();

    // Decrypt the new PII map
    const newPiiMap = await decryptPIIMap(result.piiMap, key);

    // Load and merge with existing PII map if any
    const existing = await this.storage.load(this.sessionId);
    let mergedPiiMap: RawPIIMap;
    let mergedEntityCounts: Record<string, number>;
    let createdAt: number;

    if (existing !== null) {
      // Decrypt existing PII map
      const existingPiiMap = await decryptPIIMap(existing.piiMap, key);

      // Merge maps: start with existing, add new entries
      mergedPiiMap = new Map(existingPiiMap);
      for (const [k, v] of newPiiMap) {
        mergedPiiMap.set(k, v);
      }

      // Merge entity counts
      mergedEntityCounts = { ...existing.metadata.entityCounts };
      for (const [type, count] of Object.entries(result.stats.countsByType)) {
        mergedEntityCounts[type] = (mergedEntityCounts[type] ?? 0) + count;
      }

      // Preserve original creation time
      createdAt = existing.metadata.createdAt;
    } else {
      mergedPiiMap = newPiiMap;
      mergedEntityCounts = result.stats.countsByType;
      createdAt = Date.now();
    }

    // Re-encrypt the merged PII map
    const encryptedMergedMap = await encryptPIIMap(mergedPiiMap, key);

    // Save the merged PII map to storage
    await this.storage.save(this.sessionId, encryptedMergedMap, {
      createdAt,
      entityCounts: mergedEntityCounts,
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
