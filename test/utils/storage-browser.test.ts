/**
 * Browser Storage Provider Tests
 * Uses fake-indexeddb to mock IndexedDB in Node.js environment
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { BrowserStorageProvider } from "../../src/utils/storage-browser.js";

describe("BrowserStorageProvider", () => {
  let provider: BrowserStorageProvider;

  beforeEach(() => {
    provider = new BrowserStorageProvider();
    // Clear IndexedDB between tests
    indexedDB.deleteDatabase("bridge-anonymization");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCacheDir", () => {
    it("should return virtual cache path", () => {
      const cacheDir = provider.getCacheDir("models");
      expect(cacheDir).toBe("bridge-anonymization/models");
    });

    it("should return different paths for different subdirs", () => {
      expect(provider.getCacheDir("models")).toBe("bridge-anonymization/models");
      expect(provider.getCacheDir("semantic-data")).toBe(
        "bridge-anonymization/semantic-data"
      );
    });
  });

  describe("mkdir", () => {
    it("should be a no-op (directories are implicit)", async () => {
      // mkdir should complete without error
      await expect(provider.mkdir("some/nested/path")).resolves.toBeUndefined();
    });
  });

  describe("writeFile and readFile", () => {
    it("should write and read string data via IndexedDB", async () => {
      const testPath = "test/file.txt";
      const testContent = "Hello, World!";

      await provider.writeFile(testPath, testContent);
      const data = await provider.readFile(testPath);

      const result = new TextDecoder().decode(data);
      expect(result).toBe(testContent);
    });

    it("should write and read Uint8Array data via IndexedDB", async () => {
      const testPath = "test/binary.bin";
      const testData = new Uint8Array([1, 2, 3, 4, 5]);

      await provider.writeFile(testPath, testData);
      const data = await provider.readFile(testPath);

      expect(data).toEqual(testData);
    });

    it("should throw for non-existent file", async () => {
      await expect(provider.readFile("nonexistent.txt")).rejects.toThrow(
        "File not found"
      );
    });

    it("should normalize path by removing leading slashes", async () => {
      await provider.writeFile("/leading/slash/file.txt", "content");
      const data = await provider.readFile("leading/slash/file.txt");
      expect(new TextDecoder().decode(data)).toBe("content");
    });
  });

  describe("readTextFile", () => {
    it("should read string data directly", async () => {
      const testPath = "test/text.txt";
      await provider.writeFile(testPath, "Text content");

      const result = await provider.readTextFile(testPath);

      expect(result).toBe("Text content");
    });

    it("should decode Uint8Array as UTF-8 by default", async () => {
      const testPath = "test/encoded.txt";
      const encoder = new TextEncoder();
      await provider.writeFile(testPath, encoder.encode("UTF-8 content"));

      const result = await provider.readTextFile(testPath);

      expect(result).toBe("UTF-8 content");
    });

    it("should decode Uint8Array as latin1 when specified", async () => {
      const testPath = "test/latin1.txt";
      // Create latin1 encoded data
      const latin1Data = new Uint8Array([72, 233, 108, 108, 111]); // "Héllo" in latin1
      await provider.writeFile(testPath, latin1Data);

      const result = await provider.readTextFile(testPath, "latin1");

      expect(result).toBe("Héllo");
    });

    it("should throw for non-existent file", async () => {
      await expect(provider.readTextFile("nonexistent.txt")).rejects.toThrow(
        "File not found"
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const testPath = "test/exists.txt";
      await provider.writeFile(testPath, "content");

      const result = await provider.exists(testPath);

      expect(result).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      const result = await provider.exists("nonexistent.txt");

      expect(result).toBe(false);
    });
  });

  describe("rm", () => {
    it("should remove a file from IndexedDB", async () => {
      const testPath = "test/to-remove.txt";
      await provider.writeFile(testPath, "delete me");

      await provider.rm(testPath);

      const exists = await provider.exists(testPath);
      expect(exists).toBe(false);
    });

    it("should remove multiple files with recursive option", async () => {
      await provider.writeFile("test-dir/file1.txt", "content1");
      await provider.writeFile("test-dir/file2.txt", "content2");
      await provider.writeFile("test-dir/nested/file3.txt", "content3");

      await provider.rm("test-dir", { recursive: true });

      expect(await provider.exists("test-dir/file1.txt")).toBe(false);
      expect(await provider.exists("test-dir/file2.txt")).toBe(false);
      expect(await provider.exists("test-dir/nested/file3.txt")).toBe(false);
    });

    it("should not throw with force option for non-existent file", async () => {
      await expect(
        provider.rm("nonexistent.txt", { force: true })
      ).resolves.not.toThrow();
    });
  });

  describe("OPFS path detection", () => {
    it("should identify ONNX model files as OPFS candidates", async () => {
      // This tests the internal shouldUseOPFS logic via write/read
      // In actual browser with OPFS, model files would go to OPFS
      // Without OPFS available (fake-indexeddb doesn't support it),
      // the file falls back to IndexedDB

      const modelPath = "bridge-anonymization/models/quantized/model.onnx";
      const testData = new Uint8Array([0, 1, 2, 3]);

      await provider.writeFile(modelPath, testData);

      // File should still be accessible (via IndexedDB fallback)
      const exists = await provider.exists(modelPath);
      expect(exists).toBe(true);
    });

    it("should identify .bin files in models as OPFS candidates", async () => {
      const binPath = "bridge-anonymization/models/weights.bin";
      const testData = new Uint8Array([10, 20, 30]);

      await provider.writeFile(binPath, testData);

      const exists = await provider.exists(binPath);
      expect(exists).toBe(true);
    });

    it("should use IndexedDB for non-model files", async () => {
      const textPath = "bridge-anonymization/config.json";
      const testContent = '{"key": "value"}';

      await provider.writeFile(textPath, testContent);

      const content = await provider.readTextFile(textPath);
      expect(content).toBe(testContent);
    });
  });

  describe("error handling", () => {
    it("should throw descriptive error for invalid data type in readFile", async () => {
      // Write something that's not a string or Uint8Array directly to IndexedDB
      // This is an edge case that shouldn't normally happen
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bridge-anonymization", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains("files")) {
            db.createObjectStore("files");
          }
        };
      });

      // Store an invalid data type (number)
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("files", "readwrite");
        const store = transaction.objectStore("files");
        store.put(12345, "invalid/data");
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      });

      await expect(provider.readFile("invalid/data")).rejects.toThrow(
        "Invalid data type"
      );
    });
  });
});

