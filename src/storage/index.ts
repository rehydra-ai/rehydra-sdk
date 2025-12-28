/**
 * PII Storage Module
 * Provides storage providers for persisting encrypted PII maps
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

// Export implementations
export { InMemoryPIIStorageProvider } from "./in-memory.js";
export { SQLitePIIStorageProvider } from "./sqlite.js";
export { IndexedDBPIIStorageProvider } from "./indexeddb.js";

// Export session implementation
export { AnonymizerSessionImpl } from "./session.js";

