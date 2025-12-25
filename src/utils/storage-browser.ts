/**
 * Browser Storage Provider
 * Implements StorageProvider using IndexedDB for text data and OPFS for binary files
 */

import type { StorageProvider } from "./storage.js";
import { join } from "./path.js";

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = "bridge-anonymization";
const DB_VERSION = 1;
const STORE_NAME = "files";
const CACHE_PREFIX = "bridge-anonymization";

// ============================================================================
// IndexedDB Helpers
// ============================================================================

/**
 * Opens the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (): void => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = (): void => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Gets a value from IndexedDB
 */
async function idbGet(key: string): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = (): void => {
      reject(new Error(`Failed to read from IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = (): void => {
      resolve(request.result);
    };

    transaction.oncomplete = (): void => {
      db.close();
    };
  });
}

/**
 * Sets a value in IndexedDB
 */
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onerror = (): void => {
      reject(new Error(`Failed to write to IndexedDB: ${request.error?.message}`));
    };

    transaction.oncomplete = (): void => {
      db.close();
      resolve();
    };
  });
}

/**
 * Deletes a value from IndexedDB
 */
async function idbDelete(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onerror = (): void => {
      reject(new Error(`Failed to delete from IndexedDB: ${request.error?.message}`));
    };

    transaction.oncomplete = (): void => {
      db.close();
      resolve();
    };
  });
}

/**
 * Gets all keys from IndexedDB that start with a prefix
 */
async function idbGetKeysWithPrefix(prefix: string): Promise<string[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAllKeys();

    request.onerror = (): void => {
      reject(new Error(`Failed to get keys from IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = (): void => {
      const allKeys = request.result as string[];
      const matchingKeys = allKeys.filter(
        (key) => typeof key === "string" && key.startsWith(prefix)
      );
      resolve(matchingKeys);
    };

    transaction.oncomplete = (): void => {
      db.close();
    };
  });
}

// ============================================================================
// OPFS Helpers
// ============================================================================

/**
 * Checks if OPFS is available
 */
function isOPFSAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    "getDirectory" in navigator.storage
  );
}

/**
 * Gets the OPFS root directory handle
 */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOPFSAvailable()) {
    throw new Error("Origin Private File System is not available in this browser");
  }
  return navigator.storage.getDirectory();
}

/**
 * Gets a file handle from OPFS, creating parent directories if needed
 */
async function getOPFSFileHandle(
  path: string,
  create: boolean
): Promise<FileSystemFileHandle | null> {
  const root = await getOPFSRoot();
  const parts = path.split("/").filter((p) => p !== "");

  if (parts.length === 0) {
    return null;
  }

  const filename = parts.pop()!;
  let dir = root;

  // Navigate/create directories
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch {
      if (!create) return null;
      throw new Error(`Failed to access directory: ${part}`);
    }
  }

  // Get file handle
  try {
    return await dir.getFileHandle(filename, { create });
  } catch {
    if (!create) return null;
    throw new Error(`Failed to access file: ${filename}`);
  }
}

// ============================================================================
// Browser Storage Provider Implementation
// ============================================================================

/**
 * Browser implementation of StorageProvider
 * Uses IndexedDB for text data and OPFS for binary files (like models)
 */
export class BrowserStorageProvider implements StorageProvider {
  /**
   * Determines if a path should use OPFS (for large binary files)
   */
  private shouldUseOPFS(path: string): boolean {
    // Use OPFS for model files (large binaries)
    return path.includes("/models/") && (
      path.endsWith(".onnx") ||
      path.endsWith(".bin") ||
      path.endsWith(".safetensors")
    );
  }

  /**
   * Normalizes a path to a storage key
   */
  private toStorageKey(path: string): string {
    // Remove leading slashes and normalize
    return path.replace(/^\/+/, "").replace(/\/+/g, "/");
  }

  /**
   * Reads a file as binary data
   */
  async readFile(path: string): Promise<Uint8Array> {
    const key = this.toStorageKey(path);

    if (this.shouldUseOPFS(path) && isOPFSAvailable()) {
      // Read from OPFS
      const handle = await getOPFSFileHandle(key, false);
      if (!handle) {
        throw new Error(`File not found: ${path}`);
      }
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    }

    // Read from IndexedDB
    const data = await idbGet(key);
    if (data === undefined) {
      throw new Error(`File not found: ${path}`);
    }

    if (data instanceof Uint8Array) {
      return data;
    }

    if (typeof data === "string") {
      const encoder = new TextEncoder();
      return encoder.encode(data);
    }

    throw new Error(`Invalid data type for file: ${path}`);
  }

  /**
   * Reads a file as text
   */
  async readTextFile(path: string, encoding?: string): Promise<string> {
    const key = this.toStorageKey(path);

    // First try IndexedDB (where we store text files)
    const data = await idbGet(key);

    if (data !== undefined) {
      if (typeof data === "string") {
        return data;
      }
      if (data instanceof Uint8Array) {
        // Handle latin1 encoding
        if (encoding === "latin1") {
          // Latin1 is a 1:1 mapping of byte values to characters
          return Array.from(data)
            .map((b) => String.fromCharCode(b))
            .join("");
        }
        const decoder = new TextDecoder(encoding ?? "utf-8");
        return decoder.decode(data);
      }
    }

    // Try OPFS as fallback
    if (isOPFSAvailable()) {
      const handle = await getOPFSFileHandle(key, false);
      if (handle) {
        const file = await handle.getFile();
        if (encoding === "latin1") {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          return Array.from(bytes)
            .map((b) => String.fromCharCode(b))
            .join("");
        }
        return file.text();
      }
    }

    throw new Error(`File not found: ${path}`);
  }

  /**
   * Writes data to a file
   */
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const key = this.toStorageKey(path);

    if (this.shouldUseOPFS(path) && isOPFSAvailable()) {
      // Write to OPFS for large binary files
      const handle = await getOPFSFileHandle(key, true);
      if (!handle) {
        throw new Error(`Failed to create file: ${path}`);
      }
      const writable = await handle.createWritable();
      // Cast data to the expected type for FileSystemWritableFileStream
      await writable.write(typeof data === "string" ? data : (data as BlobPart));
      await writable.close();
    } else {
      // Write to IndexedDB for smaller/text files
      await idbSet(key, data);
    }
  }

  /**
   * Checks if a file exists
   */
  async exists(path: string): Promise<boolean> {
    const key = this.toStorageKey(path);

    // Check IndexedDB first
    const idbData = await idbGet(key);
    if (idbData !== undefined) {
      return true;
    }

    // Check OPFS
    if (isOPFSAvailable()) {
      const handle = await getOPFSFileHandle(key, false);
      if (handle) {
        return true;
      }
    }

    return false;
  }

  /**
   * Creates a directory (no-op in browser storage, directories are implicit)
   */
  async mkdir(_path: string): Promise<void> {
    // Directories are created implicitly when writing files
    // For OPFS, we create them when needed
  }

  /**
   * Removes a file or directory
   */
  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    const key = this.toStorageKey(path);

    if (options?.recursive === true) {
      // Delete all keys with this prefix from IndexedDB
      const keys = await idbGetKeysWithPrefix(key);
      for (const k of keys) {
        await idbDelete(k);
      }

      // Delete from OPFS if available
      if (isOPFSAvailable()) {
        try {
          const root = await getOPFSRoot();
          const parts = key.split("/").filter((p) => p !== "");
          let dir = root;

          // Navigate to parent directory
          for (let i = 0; i < parts.length - 1; i++) {
            try {
              dir = await dir.getDirectoryHandle(parts[i]!);
            } catch {
              return; // Directory doesn't exist
            }
          }

          // Remove the entry
          const name = parts[parts.length - 1];
          if (name !== undefined && name !== "") {
            await dir.removeEntry(name, { recursive: true });
          }
        } catch {
          if (options?.force !== true) {
            throw new Error(`Failed to remove: ${path}`);
          }
        }
      }
    } else {
      // Delete single file
      try {
        await idbDelete(key);
      } catch (e) {
        if (options?.force !== true) throw e;
      }

      if (isOPFSAvailable()) {
        try {
          const handle = await getOPFSFileHandle(key, false);
          if (handle !== null) {
            const root = await getOPFSRoot();
            const parts = key.split("/").filter((p) => p !== "");
            let dir = root;

            for (let i = 0; i < parts.length - 1; i++) {
              dir = await dir.getDirectoryHandle(parts[i]!);
            }

            await dir.removeEntry(parts[parts.length - 1]!);
          }
        } catch (e) {
          if (options?.force !== true) throw e;
        }
      }
    }
  }

  /**
   * Gets the cache directory path (virtual path in browser)
   */
  getCacheDir(subdir: string): string {
    return join(CACHE_PREFIX, subdir);
  }
}

