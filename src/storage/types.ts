/**
 * PII Storage Provider Types
 * Interfaces and types for persisting encrypted PII maps
 */

// Re-export EncryptedPIIMap from types module (avoid duplication)
export { EncryptedPIIMap } from "../types/index.js";
import type {
  EncryptedPIIMap,
  AnonymizationResult,
  AnonymizationPolicy,
} from "../types/index.js";

/**
 * Metadata associated with a stored PII map
 */
export interface PIIMapMetadata {
  /** Unix timestamp when the PII map was created */
  createdAt: number;
  /** Unix timestamp when the PII map was last updated */
  updatedAt?: number;
  /** Count of entities by type (e.g., { PERSON: 2, EMAIL: 1 }) */
  entityCounts: Record<string, number>;
  /** Version of the model used for detection */
  modelVersion?: string;
}

/**
 * A stored PII map with its metadata
 */
export interface StoredPIIMap {
  /** The encrypted PII map data */
  piiMap: EncryptedPIIMap;
  /** Associated metadata */
  metadata: PIIMapMetadata;
}

/**
 * Options for listing stored PII maps
 */
export interface ListOptions {
  /** Maximum number of conversation IDs to return */
  limit?: number;
  /** Only return entries older than this date */
  olderThan?: Date;
}

/**
 * Storage provider interface for persisting encrypted PII maps
 *
 * Implementations:
 * - InMemoryPIIStorageProvider: For development/testing
 * - SQLitePIIStorageProvider: For server-side persistence (Node.js/Bun)
 * - IndexedDBPIIStorageProvider: For browser-side persistence
 *
 * @example
 * ```typescript
 * const storage = new InMemoryPIIStorageProvider();
 *
 * // Save a PII map
 * await storage.save('conv-123', encryptedPiiMap, {
 *   createdAt: Date.now(),
 *   entityCounts: { PERSON: 2, EMAIL: 1 }
 * });
 *
 * // Load it back
 * const stored = await storage.load('conv-123');
 *
 * // Cleanup old entries (optional)
 * const deleted = await storage.cleanup(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
 * ```
 */
export interface PIIStorageProvider {
  /**
   * Save an encrypted PII map
   * @param conversationId - Unique conversation identifier
   * @param piiMap - Encrypted PII map (ciphertext, iv, authTag)
   * @param metadata - Optional metadata (createdAt, entityCounts, etc.)
   *                   If not provided, createdAt defaults to current time
   */
  save(
    conversationId: string,
    piiMap: EncryptedPIIMap,
    metadata?: Partial<PIIMapMetadata>
  ): Promise<void>;

  /**
   * Load an encrypted PII map
   * @param conversationId - Unique conversation identifier
   * @returns The stored PII map with metadata, or null if not found
   */
  load(conversationId: string): Promise<StoredPIIMap | null>;

  /**
   * Delete a PII map
   * @param conversationId - Unique conversation identifier
   * @returns true if deleted, false if not found
   */
  delete(conversationId: string): Promise<boolean>;

  /**
   * Check if a PII map exists
   * @param conversationId - Unique conversation identifier
   * @returns true if exists, false otherwise
   */
  exists(conversationId: string): Promise<boolean>;

  /**
   * List stored conversation IDs
   * @param options - Optional filtering/limiting options
   * @returns Array of conversation IDs
   */
  list(options?: ListOptions): Promise<string[]>;

  /**
   * Delete entries older than the specified date
   * This is a manual cleanup operation - entries persist forever by default
   * @param olderThan - Delete entries with createdAt before this date
   * @returns Number of entries deleted
   */
  cleanup(olderThan: Date): Promise<number>;
}

/**
 * Session-bound interface for anonymization with automatic storage
 *
 * A session wraps an Anonymizer instance with a specific session ID,
 * automatically saving PII maps on anonymize and loading them on rehydrate.
 *
 * @example
 * ```typescript
 * const session = anonymizer.session('chat-123');
 *
 * // Anonymize - auto-saves to storage
 * const result = await session.anonymize('Hello John Smith!');
 *
 * // Rehydrate - auto-loads and decrypts
 * const original = await session.rehydrate(translatedText);
 * ```
 */
export interface AnonymizerSession {
  /** The session identifier */
  readonly sessionId: string;

  /**
   * Anonymize text and automatically save the encrypted PII map
   * @param text - Input text to anonymize
   * @param locale - Optional locale hint (e.g., 'de-DE', 'en-US')
   * @param policy - Optional policy override
   * @returns Anonymization result (same as Anonymizer.anonymize)
   */
  anonymize(
    text: string,
    locale?: string,
    policy?: Partial<AnonymizationPolicy>
  ): Promise<AnonymizationResult>;

  /**
   * Rehydrate anonymized text by loading and decrypting the stored PII map
   * @param text - Anonymized text with PII placeholders
   * @returns Original text with PII values restored
   * @throws Error if no PII map found for this session
   */
  rehydrate(text: string): Promise<string>;

  /**
   * Load the stored PII map for this session (without decrypting)
   * @returns The stored PII map with metadata, or null if not found
   */
  load(): Promise<StoredPIIMap | null>;

  /**
   * Delete the stored PII map for this session
   * @returns true if deleted, false if not found
   */
  delete(): Promise<boolean>;

  /**
   * Check if a PII map exists for this session
   * @returns true if exists, false otherwise
   */
  exists(): Promise<boolean>;
}

