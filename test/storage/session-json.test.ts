/**
 * Tests for AnonymizerSession.anonymizeJson / rehydrateJson
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createAnonymizer,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  type Anonymizer,
  type PIIStorageProvider,
  type KeyProvider,
  type AnonymizerSession,
} from "../../src/index.js";

describe("AnonymizerSession JSON methods", () => {
  let anonymizer: Anonymizer;
  let storage: PIIStorageProvider;
  let keyProvider: KeyProvider;
  let session: AnonymizerSession;

  beforeEach(async () => {
    storage = new InMemoryPIIStorageProvider();
    keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      ner: { mode: "disabled" },
      piiStorageProvider: storage,
      keyProvider,
    });
    await anonymizer.initialize();
    session = anonymizer.session("test-json");
  });

  afterEach(async () => {
    await anonymizer.dispose();
  });

  describe("anonymizeJson", () => {
    it("should anonymize strings in a flat object", async () => {
      const result = await session.anonymizeJson({
        email: "john@example.com",
        note: "No PII here",
      });

      expect(result.email).toContain("<PII");
      expect(result.email).toContain('type="EMAIL"');
      expect(result.email).not.toContain("john@example.com");
      expect(result.note).toBe("No PII here");
    });

    it("should anonymize strings in nested objects", async () => {
      const result = await session.anonymizeJson({
        user: {
          contact: {
            email: "jane@example.com",
          },
        },
      });

      expect(result.user.contact.email).toContain("<PII");
      expect(result.user.contact.email).toContain('type="EMAIL"');
    });

    it("should anonymize strings in arrays", async () => {
      const result = await session.anonymizeJson({
        emails: ["alice@example.com", "bob@example.com"],
      });

      expect(result.emails).toHaveLength(2);
      for (const email of result.emails) {
        expect(email).toContain("<PII");
        expect(email).toContain('type="EMAIL"');
      }
    });

    it("should preserve non-string primitives", async () => {
      const result = await session.anonymizeJson({
        name: "Contact alice@test.com about the project",
        age: 30,
        active: true,
        data: null,
      });

      expect(result.age).toBe(30);
      expect(result.active).toBe(true);
      expect(result.data).toBeNull();
    });

    it("should return a deep copy (not mutate input)", async () => {
      const input = {
        email: "john@example.com",
        nested: { value: "hello" },
      };
      const result = await session.anonymizeJson(input);

      expect(input.email).toBe("john@example.com");
      expect(input.nested.value).toBe("hello");
      expect(result).not.toBe(input);
      expect(result.nested).not.toBe(input.nested);
    });

    it("should handle a top-level string", async () => {
      const result = await session.anonymizeJson("john@example.com");
      expect(result).toContain("<PII");
    });

    it("should handle empty objects and arrays", async () => {
      expect(await session.anonymizeJson({})).toEqual({});
      expect(await session.anonymizeJson([])).toEqual([]);
    });

    it("should maintain PII ID continuity with prior anonymize calls", async () => {
      // First, anonymize via regular text method
      const textResult = await session.anonymize(
        "Contact john@example.com please",
      );
      // Extract the ID from the text result
      const idMatch = textResult.anonymizedText.match(/id="(\d+)"/);
      expect(idMatch).not.toBeNull();
      const textId = idMatch![1];

      // Now anonymize the same email via anonymizeJson
      const jsonResult = await session.anonymizeJson({
        email: "john@example.com",
      });

      // Should reuse the same ID
      expect(jsonResult.email).toContain(`id="${textId}"`);
    });
  });

  describe("rehydrateJson", () => {
    it("should reverse anonymizeJson output", async () => {
      const original = {
        email: "john@example.com",
        message: "No PII here",
        count: 42,
      };

      const anonymized = await session.anonymizeJson(original);
      const rehydrated = await session.rehydrateJson(anonymized);

      expect(rehydrated).toEqual(original);
    });

    it("should handle deeply nested round-trip", async () => {
      const original = {
        user: {
          contacts: [
            { email: "alice@example.com", label: "work" },
            { email: "bob@example.com", label: "personal" },
          ],
          note: "No PII",
        },
        count: 2,
      };

      const anonymized = await session.anonymizeJson(original);
      const rehydrated = await session.rehydrateJson(anonymized);

      expect(rehydrated).toEqual(original);
    });

    it("should handle top-level string round-trip", async () => {
      const original = "Contact john@example.com";
      const anonymized = await session.anonymizeJson(original);
      const rehydrated = await session.rehydrateJson(anonymized);
      expect(rehydrated).toBe(original);
    });

    it("should handle values with no PII (passthrough)", async () => {
      const original = { status: "ok", code: 200, items: ["a", "b"] };
      const anonymized = await session.anonymizeJson(original);
      // No PII detected, so strings should be unchanged
      expect(anonymized).toEqual(original);

      const rehydrated = await session.rehydrateJson(anonymized);
      expect(rehydrated).toEqual(original);
    });
  });

  describe("cross-method PII continuity", () => {
    it("should rehydrateJson data that was anonymized via anonymize()", async () => {
      // Anonymize via text method
      const textResult = await session.anonymize("john@example.com");
      const anonymizedEmail = textResult.anonymizedText;

      // Rehydrate via JSON method
      const result = await session.rehydrateJson({
        email: anonymizedEmail,
      });
      expect(result.email).toBe("john@example.com");
    });

    it("should rehydrate() data that was anonymized via anonymizeJson()", async () => {
      // Anonymize via JSON method
      const jsonResult = await session.anonymizeJson({
        email: "john@example.com",
      });

      // Rehydrate via text method
      const result = await session.rehydrate(jsonResult.email);
      expect(result).toBe("john@example.com");
    });
  });
});
