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
      // Note: ciphertext won't match exactly because the session re-encrypts after merging,
      // but the decrypted content should be the same
      expect(stored!.piiMap.iv).toBeDefined();
      expect(stored!.piiMap.authTag).toBeDefined();
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

  describe("key mismatch handling", () => {
    it("should throw descriptive error when decryption fails due to key mismatch", async () => {
      // Create session with one key and store some data
      const session = anonymizer.session("key-mismatch-test");
      await session.anonymize("test@example.com");

      // Create a new anonymizer with a DIFFERENT key but same storage
      const differentKeyProvider = new InMemoryKeyProvider(); // New key!
      const anonymizerWithDifferentKey = createAnonymizer({
        ner: { mode: "disabled" },
        piiStorageProvider: storage, // Same storage
        keyProvider: differentKeyProvider, // Different key
      });
      await anonymizerWithDifferentKey.initialize();

      // Try to use the session with different key
      const sessionWithDifferentKey =
        anonymizerWithDifferentKey.session("key-mismatch-test");

      // Should throw descriptive error
      await expect(
        sessionWithDifferentKey.anonymize("another@example.com")
      ).rejects.toThrow(/Failed to decrypt existing session data/);

      await anonymizerWithDifferentKey.dispose();
    });

    it("should allow recovery by deleting the session", async () => {
      // Create session with one key and store some data
      const session = anonymizer.session("recovery-test");
      await session.anonymize("test@example.com");

      // Create a new anonymizer with a DIFFERENT key but same storage
      const differentKeyProvider = new InMemoryKeyProvider();
      const anonymizerWithDifferentKey = createAnonymizer({
        ner: { mode: "disabled" },
        piiStorageProvider: storage,
        keyProvider: differentKeyProvider,
      });
      await anonymizerWithDifferentKey.initialize();

      // Get session with different key - deletion should work even with wrong key
      const sessionWithDifferentKey =
        anonymizerWithDifferentKey.session("recovery-test");

      // Delete the old session (doesn't need decryption)
      await sessionWithDifferentKey.delete();

      // Now should be able to anonymize fresh
      const result = await sessionWithDifferentKey.anonymize(
        "fresh@example.com"
      );
      expect(result.anonymizedText).toContain('type="EMAIL"');

      await anonymizerWithDifferentKey.dispose();
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

  describe("merging PII maps across multiple anonymize calls", () => {
    it("should merge PII maps with different entity types", async () => {
      const session = anonymizer.session("merge-test");

      // First anonymization with email
      const result1 = await session.anonymize("Contact: test@example.com");

      // Second anonymization with IP (different entity type)
      const result2 = await session.anonymize("Server: 192.168.1.1");

      // Both should be rehydratable using the merged stored map
      const rehydrated1 = await session.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe("Contact: test@example.com");
      expect(rehydrated2).toBe("Server: 192.168.1.1");
    });

    it("should preserve PII when follow-up message has no new PII", async () => {
      const session = anonymizer.session("preserve-test");

      // First message - detects email
      const result1 = await session.anonymize("Contact me at test@example.com");

      // Second message - no PII (like "Translate to Italian")
      await session.anonymize("Translate to Italian");

      // First message's PII should still be rehydratable
      const rehydrated = await session.rehydrate(result1.anonymizedText);
      expect(rehydrated).toBe("Contact me at test@example.com");
    });

    it("should accumulate entity counts across multiple calls", async () => {
      const session = anonymizer.session("counts-test");

      // First call with email
      await session.anonymize("first@example.com");
      const stored1 = await session.load();
      const emailCount1 = stored1!.metadata.entityCounts["EMAIL"] ?? 0;

      // Second call with another email
      await session.anonymize("second@example.com");
      const stored2 = await session.load();
      const emailCount2 = stored2!.metadata.entityCounts["EMAIL"] ?? 0;

      // Email count should have increased
      expect(emailCount2).toBe(emailCount1 + 1);
    });

    it("should preserve original createdAt timestamp", async () => {
      const session = anonymizer.session("timestamp-test");

      // First anonymization
      await session.anonymize("first@example.com");
      const stored1 = await session.load();
      const originalCreatedAt = stored1!.metadata.createdAt;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second anonymization
      await session.anonymize("second@example.com");
      const stored2 = await session.load();

      // createdAt should be preserved, updatedAt should be different
      expect(stored2!.metadata.createdAt).toBe(originalCreatedAt);
    });
  });

  describe("cross-call entity ID reuse", () => {
    it("should reuse ID when same entity value appears in later call", async () => {
      const session = anonymizer.session("id-reuse-test");

      // First call with email
      const result1 = await session.anonymize("Contact: test@example.com");

      // Second call with SAME email
      const result2 = await session.anonymize("Email again: test@example.com");

      // Both should produce the same tag (EMAIL_1)
      expect(result1.anonymizedText).toContain('id="1"');
      expect(result2.anonymizedText).toContain('id="1"');

      // Both should rehydrate correctly
      const rehydrated1 = await session.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe("Contact: test@example.com");
      expect(rehydrated2).toBe("Email again: test@example.com");
    });

    it("should assign different IDs for different entities of same type", async () => {
      const session = anonymizer.session("different-ids-test");

      // First call with first email
      const result1 = await session.anonymize("first@example.com");
      expect(result1.anonymizedText).toContain('id="1"');

      // Second call with DIFFERENT email
      const result2 = await session.anonymize("second@example.com");
      expect(result2.anonymizedText).toContain('id="2"');

      // Both should rehydrate correctly
      const rehydrated1 = await session.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe("first@example.com");
      expect(rehydrated2).toBe("second@example.com");
    });

    it("should start new IDs from max existing ID + 1", async () => {
      const session = anonymizer.session("max-id-test");

      // First call with two emails
      const result1 = await session.anonymize(
        "Contact: first@example.com and second@example.com"
      );
      // Should have EMAIL_1 and EMAIL_2
      expect(result1.anonymizedText).toContain('id="1"');
      expect(result1.anonymizedText).toContain('id="2"');

      // Second call with new email
      const result2 = await session.anonymize("third@example.com");
      // Should be EMAIL_3 (continuing from max)
      expect(result2.anonymizedText).toContain('id="3"');

      // All should rehydrate correctly
      const rehydrated1 = await session.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe(
        "Contact: first@example.com and second@example.com"
      );
      expect(rehydrated2).toBe("third@example.com");
    });

    it("should handle mix of reused and new entities", async () => {
      const session = anonymizer.session("mix-test");

      // First call
      const result1 = await session.anonymize("first@example.com");
      expect(result1.anonymizedText).toContain('id="1"');

      // Second call with same entity and new entity
      const result2 = await session.anonymize(
        "first@example.com and second@example.com"
      );

      // first@ should reuse id="1", second@ should get id="2"
      // Both IDs should be present (1 reused, 2 new)
      expect(result2.anonymizedText).toContain('id="1"');
      expect(result2.anonymizedText).toContain('id="2"');

      // Rehydration should restore both correctly
      const rehydrated1 = await session.rehydrate(result1.anonymizedText);
      const rehydrated2 = await session.rehydrate(result2.anonymizedText);

      expect(rehydrated1).toBe("first@example.com");
      expect(rehydrated2).toBe("first@example.com and second@example.com");
    });

    it("should handle complex conversation scenario", async () => {
      const session = anonymizer.session("conversation-test");

      // Message 1: User introduces themselves
      const msg1 = await session.anonymize(
        "Contact me at user@example.com or call +49 30 12345678"
      );

      // Message 2: No PII
      await session.anonymize("Please translate this to German");

      // Message 3: Reference existing PII and add new
      const msg3 = await session.anonymize(
        "Send to user@example.com and also admin@example.com"
      );

      // Message 4: Only references existing PII
      const msg4 = await session.anonymize(
        "Reminder: call +49 30 12345678 tomorrow"
      );

      // All messages should rehydrate correctly
      const rehydrated1 = await session.rehydrate(msg1.anonymizedText);
      const rehydrated3 = await session.rehydrate(msg3.anonymizedText);
      const rehydrated4 = await session.rehydrate(msg4.anonymizedText);

      expect(rehydrated1).toBe(
        "Contact me at user@example.com or call +49 30 12345678"
      );
      expect(rehydrated3).toBe(
        "Send to user@example.com and also admin@example.com"
      );
      expect(rehydrated4).toBe("Reminder: call +49 30 12345678 tomorrow");
    });
  });
});

