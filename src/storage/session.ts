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
    policy?: Partial<AnonymizationPolicy>,
    existingPiiMap?: RawPIIMap
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
    // Get the encryption key
    const key = await this.keyProvider.getKey();

    // Load existing PII map for ID reuse (before calling anonymizer)
    const existing = await this.storage.load(this.sessionId);
    let existingPiiMap: RawPIIMap | undefined;
    let createdAt: number;
    let existingEntityCounts: Record<string, number>;

    if (existing !== null) {
      try {
        existingPiiMap = await decryptPIIMap(existing.piiMap, key);
        createdAt = existing.metadata.createdAt;
        existingEntityCounts = existing.metadata.entityCounts;
      } catch (error) {
        // Decryption failed - likely key mismatch
        const isKeyMismatch = 
          error instanceof Error && 
          (error.name === "OperationError" || error.message.includes("decrypt"));
        
        if (isKeyMismatch) {
          throw new Error(
            `Failed to decrypt existing session data for "${this.sessionId}". ` +
            `The encryption key may have changed since this session was created.\n\n` +
            `To fix this, either:\n` +
            `  1. Use the same key that was used to create the session\n` +
            `  2. Delete the old session: await session.delete()\n` +
            `  3. Use a persistent key provider (e.g., ConfigKeyProvider)`
          );
        }
        throw error;
      }
    } else {
      existingPiiMap = undefined;
      createdAt = Date.now();
      existingEntityCounts = {};
    }

    // Call the parent anonymizer with existing PII map for ID reuse
    const result = await this.anonymizer.anonymize(
      text,
      locale,
      policy,
      existingPiiMap
    );

    // Decrypt the new PII map
    const newPiiMap = await decryptPIIMap(result.piiMap, key);

    // Merge maps: start with existing (if any), add new entries
    const mergedPiiMap: RawPIIMap = existingPiiMap
      ? new Map<string, string>(existingPiiMap)
      : new Map<string, string>();
    for (const [k, v] of newPiiMap) {
      mergedPiiMap.set(k, v);
    }

    // Merge entity counts
    const mergedEntityCounts = { ...existingEntityCounts };
    for (const [type, count] of Object.entries(result.stats.countsByType)) {
      mergedEntityCounts[type] = (mergedEntityCounts[type] ?? 0) + count;
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
