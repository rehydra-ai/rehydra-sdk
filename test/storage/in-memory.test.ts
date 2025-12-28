/**
 * Tests for InMemoryPIIStorageProvider
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";
import type { EncryptedPIIMap } from "../../src/types/index.js";

describe("InMemoryPIIStorageProvider", () => {
  let storage: InMemoryPIIStorageProvider;

  // Sample encrypted PII map for testing
  const samplePiiMap: EncryptedPIIMap = {
    ciphertext: "dGVzdCBjaXBoZXJ0ZXh0",
    iv: "dGVzdCBpdg==",
    authTag: "dGVzdCBhdXRoIHRhZw==",
  };

  beforeEach(() => {
    storage = new InMemoryPIIStorageProvider();
  });

  describe("save", () => {
    it("should save a PII map", async () => {
      await storage.save("conv-1", samplePiiMap, {
        createdAt: Date.now(),
        entityCounts: { PERSON: 2, EMAIL: 1 },
      });

      expect(storage.size).toBe(1);
    });

    it("should save without metadata", async () => {
      await storage.save("conv-1", samplePiiMap);

      const stored = await storage.load("conv-1");
      expect(stored).not.toBeNull();
      expect(stored?.metadata.createdAt).toBeDefined();
      expect(stored?.metadata.entityCounts).toEqual({});
    });

    it("should update existing entry preserving createdAt", async () => {
      const originalTime = Date.now() - 10000;

      await storage.save("conv-1", samplePiiMap, {
        createdAt: originalTime,
        entityCounts: { PERSON: 1 },
      });

      // Update with new data
      const newPiiMap: EncryptedPIIMap = {
        ciphertext: "bmV3IGNpcGhlcnRleHQ=",
        iv: "bmV3IGl2",
        authTag: "bmV3IGF1dGggdGFn",
      };

      await storage.save("conv-1", newPiiMap, {
        entityCounts: { PERSON: 2 },
      });

      const stored = await storage.load("conv-1");
      expect(stored?.metadata.createdAt).toBe(originalTime);
      expect(stored?.metadata.updatedAt).toBeGreaterThan(originalTime);
      expect(stored?.metadata.entityCounts).toEqual({ PERSON: 2 });
      expect(stored?.piiMap.ciphertext).toBe(newPiiMap.ciphertext);
    });
  });

  describe("load", () => {
    it("should load an existing PII map", async () => {
      await storage.save("conv-1", samplePiiMap, {
        createdAt: 1234567890,
        entityCounts: { PERSON: 2 },
        modelVersion: "1.0.0",
      });

      const stored = await storage.load("conv-1");

      expect(stored).not.toBeNull();
      expect(stored?.piiMap).toEqual(samplePiiMap);
      expect(stored?.metadata.createdAt).toBe(1234567890);
      expect(stored?.metadata.entityCounts).toEqual({ PERSON: 2 });
      expect(stored?.metadata.modelVersion).toBe("1.0.0");
    });

    it("should return null for non-existent entry", async () => {
      const stored = await storage.load("non-existent");
      expect(stored).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete an existing entry", async () => {
      await storage.save("conv-1", samplePiiMap);

      const deleted = await storage.delete("conv-1");

      expect(deleted).toBe(true);
      expect(storage.size).toBe(0);
    });

    it("should return false for non-existent entry", async () => {
      const deleted = await storage.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("exists", () => {
    it("should return true for existing entry", async () => {
      await storage.save("conv-1", samplePiiMap);

      const exists = await storage.exists("conv-1");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent entry", async () => {
      const exists = await storage.exists("non-existent");
      expect(exists).toBe(false);
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      // Add entries with different timestamps
      await storage.save("conv-1", samplePiiMap, { createdAt: 1000 });
      await storage.save("conv-2", samplePiiMap, { createdAt: 2000 });
      await storage.save("conv-3", samplePiiMap, { createdAt: 3000 });
    });

    it("should list all entries in descending order", async () => {
      const ids = await storage.list();

      expect(ids).toEqual(["conv-3", "conv-2", "conv-1"]);
    });

    it("should respect limit option", async () => {
      const ids = await storage.list({ limit: 2 });

      expect(ids).toEqual(["conv-3", "conv-2"]);
    });

    it("should filter by olderThan", async () => {
      const ids = await storage.list({ olderThan: new Date(2500) });

      expect(ids).toEqual(["conv-2", "conv-1"]);
    });

    it("should combine limit and olderThan", async () => {
      const ids = await storage.list({
        olderThan: new Date(2500),
        limit: 1,
      });

      expect(ids).toEqual(["conv-2"]);
    });

    it("should return empty array when no entries", async () => {
      storage.clear();
      const ids = await storage.list();
      expect(ids).toEqual([]);
    });
  });

  describe("cleanup", () => {
    beforeEach(async () => {
      await storage.save("conv-1", samplePiiMap, { createdAt: 1000 });
      await storage.save("conv-2", samplePiiMap, { createdAt: 2000 });
      await storage.save("conv-3", samplePiiMap, { createdAt: 3000 });
    });

    it("should delete entries older than specified date", async () => {
      const deleted = await storage.cleanup(new Date(2500));

      expect(deleted).toBe(2);
      expect(storage.size).toBe(1);
      expect(await storage.exists("conv-3")).toBe(true);
    });

    it("should return 0 when no entries match", async () => {
      const deleted = await storage.cleanup(new Date(500));

      expect(deleted).toBe(0);
      expect(storage.size).toBe(3);
    });

    it("should delete all entries if all are older", async () => {
      const deleted = await storage.cleanup(new Date(4000));

      expect(deleted).toBe(3);
      expect(storage.size).toBe(0);
    });
  });

  describe("clear", () => {
    it("should clear all entries", async () => {
      await storage.save("conv-1", samplePiiMap);
      await storage.save("conv-2", samplePiiMap);

      storage.clear();

      expect(storage.size).toBe(0);
    });
  });
});

