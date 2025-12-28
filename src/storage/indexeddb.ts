/**
 * IndexedDB PII Storage Provider
 * Browser-side persistence using IndexedDB
 */

import type { EncryptedPIIMap } from "../types/index.js";
import type {
  PIIStorageProvider,
  PIIMapMetadata,
  StoredPIIMap,
  ListOptions,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DB_NAME = "rehydra-pii-storage";
const DB_VERSION = 1;
const STORE_NAME = "pii_maps";

// ============================================================================
// IndexedDB Record Type
// ============================================================================

/**
 * Record stored in IndexedDB
 */
interface PIIMapRecord {
  conversationId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  entityCounts: Record<string, number>;
  modelVersion?: string;
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// IndexedDB Storage Provider
// ============================================================================

/**
 * IndexedDB implementation of PIIStorageProvider
 *
 * For browser-side persistence. Data persists across sessions and page reloads.
 *
 * @example
 * ```typescript
 * const storage = new IndexedDBPIIStorageProvider('my-app');
 *
 * await storage.save('conv-123', encryptedPiiMap, {
 *   createdAt: Date.now(),
 *   entityCounts: { PERSON: 2 }
 * });
 *
 * const stored = await storage.load('conv-123');
 * ```
 */
export class IndexedDBPIIStorageProvider implements PIIStorageProvider {
  private readonly dbName: string;
  private db: IDBDatabase | null = null;

  /**
   * Create a new IndexedDB storage provider
   * @param dbName - Database name (defaults to 'rehydra-pii-storage')
   */
  constructor(dbName: string = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  /**
   * Open the IndexedDB database
   */
  private async openDatabase(): Promise<IDBDatabase> {
    if (this.db !== null) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = (): void => {
        reject(
          new Error(`Failed to open IndexedDB: ${request.error?.message}`)
        );
      };

      request.onsuccess = (): void => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "conversationId",
          });
          // Create index on createdAt for efficient cleanup queries
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    });
  }

  /**
   * Save an encrypted PII map
   */
  async save(
    conversationId: string,
    piiMap: EncryptedPIIMap,
    metadata?: Partial<PIIMapMetadata>
  ): Promise<void> {
    const db = await this.openDatabase();
    const now = Date.now();

    // Check if entry exists to preserve createdAt
    const existing = await this.load(conversationId);

    const record: PIIMapRecord = {
      conversationId,
      ciphertext: piiMap.ciphertext,
      iv: piiMap.iv,
      authTag: piiMap.authTag,
      entityCounts:
        metadata?.entityCounts ?? existing?.metadata.entityCounts ?? {},
      modelVersion:
        metadata?.modelVersion ?? existing?.metadata.modelVersion ?? undefined,
      createdAt: existing?.metadata.createdAt ?? metadata?.createdAt ?? now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onerror = (): void => {
        reject(
          new Error(`Failed to save to IndexedDB: ${request.error?.message}`)
        );
      };

      transaction.oncomplete = (): void => {
        resolve();
      };
    });
  }

  /**
   * Load an encrypted PII map
   */
  async load(conversationId: string): Promise<StoredPIIMap | null> {
    const db = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(conversationId);

      request.onerror = (): void => {
        reject(
          new Error(`Failed to load from IndexedDB: ${request.error?.message}`)
        );
      };

      request.onsuccess = (): void => {
        const record = request.result as PIIMapRecord | undefined;

        if (!record) {
          resolve(null);
          return;
        }

        resolve({
          piiMap: {
            ciphertext: record.ciphertext,
            iv: record.iv,
            authTag: record.authTag,
          },
          metadata: {
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            entityCounts: record.entityCounts,
            modelVersion: record.modelVersion,
          },
        });
      };
    });
  }

  /**
   * Delete a PII map
   */
  async delete(conversationId: string): Promise<boolean> {
    const db = await this.openDatabase();

    // Check if exists first
    const exists = await this.exists(conversationId);
    if (!exists) return false;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(conversationId);

      request.onerror = (): void => {
        reject(
          new Error(
            `Failed to delete from IndexedDB: ${request.error?.message}`
          )
        );
      };

      transaction.oncomplete = (): void => {
        resolve(true);
      };
    });
  }

  /**
   * Check if a PII map exists
   */
  async exists(conversationId: string): Promise<boolean> {
    const db = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getKey(conversationId);

      request.onerror = (): void => {
        reject(
          new Error(`Failed to check IndexedDB: ${request.error?.message}`)
        );
      };

      request.onsuccess = (): void => {
        resolve(request.result !== undefined);
      };
    });
  }

  /**
   * List stored conversation IDs
   */
  async list(options?: ListOptions): Promise<string[]> {
    const db = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("createdAt");

      // Use cursor to iterate in descending order (most recent first)
      const request = index.openCursor(null, "prev");
      const results: Array<{ id: string; createdAt: number }> = [];

      request.onerror = (): void => {
        reject(
          new Error(`Failed to list from IndexedDB: ${request.error?.message}`)
        );
      };

      request.onsuccess = (): void => {
        const cursor = request.result;

        if (cursor) {
          const record = cursor.value as PIIMapRecord;

          // Filter by olderThan if specified
          if (options?.olderThan !== undefined) {
            if (record.createdAt < options.olderThan.getTime()) {
              results.push({
                id: record.conversationId,
                createdAt: record.createdAt,
              });
            }
          } else {
            results.push({
              id: record.conversationId,
              createdAt: record.createdAt,
            });
          }

          // Check limit
          if (options?.limit !== undefined && results.length >= options.limit) {
            resolve(results.map((r) => r.id));
            return;
          }

          cursor.continue();
        } else {
          // End of cursor
          resolve(results.map((r) => r.id));
        }
      };
    });
  }

  /**
   * Delete entries older than the specified date
   */
  async cleanup(olderThan: Date): Promise<number> {
    const db = await this.openDatabase();
    const cutoff = olderThan.getTime();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("createdAt");

      // Find all records with createdAt < cutoff
      const range = IDBKeyRange.upperBound(cutoff, true);
      const request = index.openCursor(range);
      let deleted = 0;

      request.onerror = (): void => {
        reject(
          new Error(
            `Failed to cleanup IndexedDB: ${request.error?.message}`
          )
        );
      };

      request.onsuccess = (): void => {
        const cursor = request.result;

        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };

      transaction.oncomplete = (): void => {
        resolve(deleted);
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Delete the entire database (useful for testing)
   */
  async deleteDatabase(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);

      request.onerror = (): void => {
        reject(
          new Error(
            `Failed to delete IndexedDB database: ${request.error?.message}`
          )
        );
      };

      request.onsuccess = (): void => {
        resolve();
      };
    });
  }
}

