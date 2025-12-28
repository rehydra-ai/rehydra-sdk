/**
 * Tests for AnonymizerSession
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createAnonymizer,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  type Anonymizer,
  type PIIStorageProvider,
  type KeyProvider,
} from "../../src/index.js";

describe("AnonymizerSession", () => {
  let anonymizer: Anonymizer;
  let storage: PIIStorageProvider;
  let keyProvider: KeyProvider;

  beforeEach(async () => {
    storage = new InMemoryPIIStorageProvider();
    keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      ner: { mode: "disabled" }, // Use regex-only for faster tests
      piiStorageProvider: storage,
      keyProvider,
    });
    await anonymizer.initialize();
  });

  afterEach(async () => {
    await anonymizer.dispose();
  });

  describe("session()", () => {
    it("should throw error if piiStorageProvider not configured", () => {
      const anonymizerNoStorage = createAnonymizer({
        keyProvider: new InMemoryKeyProvider(),
      });

      expect(() => anonymizerNoStorage.session("test")).toThrow(
        "Cannot create session: piiStorageProvider not configured"
      );
    });

    it("should throw error if keyProvider not configured", () => {
      const anonymizerNoKey = createAnonymizer({
        piiStorageProvider: new InMemoryPIIStorageProvider(),
      });

      expect(() => anonymizerNoKey.session("test")).toThrow(
        "Cannot create session: keyProvider not configured"
      );
    });

    it("should return a session with the correct sessionId", () => {
      const session = anonymizer.session("chat-123");
      expect(session.sessionId).toBe("chat-123");
    });

    it("should create multiple independent sessions", () => {
      const session1 = anonymizer.session("chat-1");
      const session2 = anonymizer.session("chat-2");

      expect(session1.sessionId).toBe("chat-1");
      expect(session2.sessionId).toBe("chat-2");
      expect(session1).not.toBe(session2);
    });
  });

  describe("anonymize()", () => {
    it("should anonymize text and auto-save to storage", async () => {
      const session = anonymizer.session("test-session");

      const result = await session.anonymize("Contact me at test@example.com");

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(result.stats.totalEntities).toBe(1);

      // Verify it was saved to storage
      const stored = await storage.load("test-session");
      expect(stored).not.toBeNull();
      expect(stored!.piiMap.ciphertext).toBe(result.piiMap.ciphertext);
    });

    it("should save metadata with entity counts", async () => {
      const session = anonymizer.session("metadata-test");

      await session.anonymize(
        "Email: test@example.com, Phone: +49 30 12345678"
      );

      const stored = await storage.load("metadata-test");
      expect(stored).not.toBeNull();
      expect(stored!.metadata.entityCounts).toHaveProperty("EMAIL");
      expect(stored!.metadata.entityCounts).toHaveProperty("PHONE");
      expect(stored!.metadata.createdAt).toBeGreaterThan(0);
    });

    it("should pass locale and policy to underlying anonymizer", async () => {
      const session = anonymizer.session("policy-test");

      const result = await session.anonymize("test@example.com", "en-US", {
        enableLeakScan: false,
      });

      expect(result.anonymizedText).toContain("EMAIL");
    });
  });

  describe("rehydrate()", () => {
    it("should rehydrate text using stored PII map", async () => {
      const session = anonymizer.session("rehydrate-test");

      // First anonymize
      const result = await session.anonymize("Contact john@example.com");
      const anonymizedText = result.anonymizedText;

      // Then rehydrate
      const rehydrated = await session.rehydrate(anonymizedText);

      expect(rehydrated).toBe("Contact john@example.com");
    });

    it("should throw error if no PII map found", async () => {
      const session = anonymizer.session("nonexistent");

      await expect(session.rehydrate("some text")).rejects.toThrow(
        "No PII map found for session: nonexistent"
      );
    });

    it("should handle multiple entities", async () => {
      const session = anonymizer.session("multi-entity");

      const original = "Email: test@example.com, IP: 192.168.1.1";
      const result = await session.anonymize(original);
      const rehydrated = await session.rehydrate(result.anonymizedText);

      expect(rehydrated).toBe(original);
    });
  });

  describe("load()", () => {
    it("should return stored PII map", async () => {
      const session = anonymizer.session("load-test");
      await session.anonymize("test@example.com");

      const stored = await session.load();

      expect(stored).not.toBeNull();
      expect(stored!.piiMap.ciphertext).toBeDefined();
      expect(stored!.metadata.createdAt).toBeGreaterThan(0);
    });

    it("should return null if not found", async () => {
      const session = anonymizer.session("nonexistent");

      const stored = await session.load();

      expect(stored).toBeNull();
    });
  });

  describe("delete()", () => {
    it("should delete stored PII map", async () => {
      const session = anonymizer.session("delete-test");
      await session.anonymize("test@example.com");

      const deleted = await session.delete();

      expect(deleted).toBe(true);
      expect(await session.exists()).toBe(false);
    });

    it("should return false if not found", async () => {
      const session = anonymizer.session("nonexistent");

      const deleted = await session.delete();

      expect(deleted).toBe(false);
    });
  });

  describe("exists()", () => {
    it("should return true if PII map exists", async () => {
      const session = anonymizer.session("exists-test");
      await session.anonymize("test@example.com");

      expect(await session.exists()).toBe(true);
    });

    it("should return false if PII map does not exist", async () => {
      const session = anonymizer.session("nonexistent");

      expect(await session.exists()).toBe(false);
    });
  });

  describe("multiple sessions with same anonymizer", () => {
    it("should maintain separate storage for different sessions", async () => {
      const session1 = anonymizer.session("session-1");
      const session2 = anonymizer.session("session-2");

      await session1.anonymize("first@example.com");
      await session2.anonymize("second@example.com");

      // Each session has its own stored data
      expect(await session1.exists()).toBe(true);
      expect(await session2.exists()).toBe(true);

      // Deleting one doesn't affect the other
      await session1.delete();
      expect(await session1.exists()).toBe(false);
      expect(await session2.exists()).toBe(true);
    });

    it("should rehydrate correctly with separate sessions", async () => {
      const session1 = anonymizer.session("session-a");
      const session2 = anonymizer.session("session-b");

      const result1 = await session1.anonymize("alice@example.com");
      const result2 = await session2.anonymize("bob@example.com");

      const rehydrated1 = await session1.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session2.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe("alice@example.com");
      expect(rehydrated2).toBe("bob@example.com");
    });
  });

  describe("overwriting existing session", () => {
    it("should overwrite previous PII map when anonymizing again", async () => {
      const session = anonymizer.session("overwrite-test");

      // First anonymization
      await session.anonymize("first@example.com");
      const stored1 = await session.load();

      // Second anonymization (overwrites)
      await session.anonymize("second@example.com");
      const stored2 = await session.load();

      // Should have different ciphertexts
      expect(stored1!.piiMap.ciphertext).not.toBe(stored2!.piiMap.ciphertext);

      // Rehydration should use the latest
      const result = await session.anonymize("third@example.com");
      const rehydrated = await session.rehydrate(result.anonymizedText);
      expect(rehydrated).toBe("third@example.com");
    });
  });
});

