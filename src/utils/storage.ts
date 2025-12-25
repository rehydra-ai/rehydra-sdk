/**
 * Storage Abstraction Layer
 * Provides a unified interface for file storage across Node.js and browser environments
 */

/**
 * Storage provider interface
 * Implementations exist for Node.js (fs) and browser (IndexedDB/OPFS)
 */
export interface StorageProvider {
  /**
   * Reads a file as binary data
   */
  readFile(path: string): Promise<Uint8Array>;

  /**
   * Reads a file as text
   * @param encoding - Character encoding (default: 'utf-8', also supports 'latin1')
   */
  readTextFile(path: string, encoding?: string): Promise<string>;

  /**
   * Writes data to a file
   * Creates parent directories if they don't exist
   */
  writeFile(path: string, data: Uint8Array | string): Promise<void>;

  /**
   * Checks if a file or directory exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Creates a directory (and parent directories if needed)
   */
  mkdir(path: string): Promise<void>;

  /**
   * Removes a file or directory
   */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  /**
   * Gets the cache directory path for a given subdirectory
   * @param subdir - Subdirectory name (e.g., 'models', 'semantic-data')
   */
  getCacheDir(subdir: string): string;
}

// ============================================================================
// Runtime Detection
// ============================================================================

/**
 * Detects if running in Node.js environment
 */
export function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions !== undefined &&
    process.versions.node !== undefined
  );
}

/**
 * Detects if running in browser environment
 */
export function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.document !== "undefined"
  );
}

/**
 * Detects if running in a Web Worker
 */
export function isWebWorker(): boolean {
  return (
    typeof self !== "undefined" &&
    typeof (self as unknown as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined"
  );
}

// ============================================================================
// Storage Provider Singleton
// ============================================================================

let storageProviderInstance: StorageProvider | null = null;

/**
 * Gets the appropriate storage provider for the current environment
 * Uses lazy loading to avoid importing unnecessary modules
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  if (storageProviderInstance !== null) {
    return storageProviderInstance;
  }

  if (isNode()) {
    // Dynamically import Node.js storage provider
    const { NodeStorageProvider } = await import("./storage-node.js");
    storageProviderInstance = new NodeStorageProvider();
  } else if (isBrowser() || isWebWorker()) {
    // Dynamically import browser storage provider
    const { BrowserStorageProvider } = await import("./storage-browser.js");
    storageProviderInstance = new BrowserStorageProvider();
  } else {
    throw new Error(
      "Unsupported environment: neither Node.js nor browser detected"
    );
  }

  return storageProviderInstance;
}

/**
 * Resets the storage provider (useful for testing)
 */
export function resetStorageProvider(): void {
  storageProviderInstance = null;
}

/**
 * Sets a custom storage provider (useful for testing)
 */
export function setStorageProvider(provider: StorageProvider): void {
  storageProviderInstance = provider;
}

