/**
 * In-Memory PII Storage Provider
 * Simple Map-based implementation for development and testing
 */

import type { EncryptedPIIMap } from "../types/index.js";
import type {
  PIIStorageProvider,
  PIIMapMetadata,
  StoredPIIMap,
  ListOptions,
} from "./types.js";

/**
 * In-memory implementation of PIIStorageProvider
 *
 * Uses a Map for storage - data is lost when the process exits.
 * Ideal for development, testing, and short-lived sessions.
 *
 * @example
 * ```typescript
 * const storage = new InMemoryPIIStorageProvider();
 *
 * await storage.save('conv-123', encryptedPiiMap, {
 *   createdAt: Date.now(),
 *   entityCounts: { PERSON: 2 }
 * });
 *
 * const stored = await storage.load('conv-123');
 * ```
 */
export class InMemoryPIIStorageProvider implements PIIStorageProvider {
  private storage: Map<string, StoredPIIMap> = new Map();

  /**
   * Save an encrypted PII map
   */
  save(
    conversationId: string,
    piiMap: EncryptedPIIMap,
    metadata?: Partial<PIIMapMetadata>
  ): Promise<void> {
    const now = Date.now();
    const existing = this.storage.get(conversationId);

    const fullMetadata: PIIMapMetadata = {
      createdAt: existing?.metadata.createdAt ?? metadata?.createdAt ?? now,
      updatedAt: now,
      entityCounts: metadata?.entityCounts ?? existing?.metadata.entityCounts ?? {},
      modelVersion: metadata?.modelVersion ?? existing?.metadata.modelVersion,
    };

    this.storage.set(conversationId, {
      piiMap,
      metadata: fullMetadata,
    });

    return Promise.resolve();
  }

  /**
   * Load an encrypted PII map
   */
  load(conversationId: string): Promise<StoredPIIMap | null> {
    return Promise.resolve(this.storage.get(conversationId) ?? null);
  }

  /**
   * Delete a PII map
   */
  delete(conversationId: string): Promise<boolean> {
    return Promise.resolve(this.storage.delete(conversationId));
  }

  /**
   * Check if a PII map exists
   */
  exists(conversationId: string): Promise<boolean> {
    return Promise.resolve(this.storage.has(conversationId));
  }

  /**
   * List stored conversation IDs
   */
  list(options?: ListOptions): Promise<string[]> {
    let entries = Array.from(this.storage.entries());

    // Filter by olderThan if specified
    if (options?.olderThan !== undefined) {
      const cutoff = options.olderThan.getTime();
      entries = entries.filter(([, stored]) => stored.metadata.createdAt < cutoff);
    }

    // Sort by createdAt descending (most recent first)
    entries.sort((a, b) => b[1].metadata.createdAt - a[1].metadata.createdAt);

    // Extract conversation IDs
    let ids = entries.map(([id]) => id);

    // Apply limit if specified
    if (options?.limit !== undefined && options.limit > 0) {
      ids = ids.slice(0, options.limit);
    }

    return Promise.resolve(ids);
  }

  /**
   * Delete entries older than the specified date
   */
  cleanup(olderThan: Date): Promise<number> {
    const cutoff = olderThan.getTime();
    let deleted = 0;

    for (const [id, stored] of this.storage.entries()) {
      if (stored.metadata.createdAt < cutoff) {
        this.storage.delete(id);
        deleted++;
      }
    }

    return Promise.resolve(deleted);
  }

  /**
   * Clear all stored data (useful for testing)
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Get the number of stored entries (useful for testing)
   */
  get size(): number {
    return this.storage.size;
  }
}

