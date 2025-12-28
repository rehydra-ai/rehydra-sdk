/**
 * Browser-Safe PII Storage Module
 * Provides storage providers for persisting encrypted PII maps (browser-only)
 * 
 * This module excludes SQLitePIIStorageProvider which requires Node.js dependencies.
 * For SQLite support, use the main storage module or import from 'rehydra/storage/sqlite'.
 */

// Export types
export type {
  PIIStorageProvider,
  PIIMapMetadata,
  StoredPIIMap,
  ListOptions,
  AnonymizerSession,
} from "./types.js";

// Re-export EncryptedPIIMap for convenience
export type { EncryptedPIIMap } from "../types/index.js";

// Export browser-compatible implementations only
export { InMemoryPIIStorageProvider } from "./in-memory.js";
export { IndexedDBPIIStorageProvider } from "./indexeddb.js";

// Export session implementation
export { AnonymizerSessionImpl } from "./session.js";

