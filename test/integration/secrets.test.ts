import { describe, it, expect, afterEach } from "vitest";
import {
  createAnonymizer,
  PIIType,
  InMemoryKeyProvider,
} from "../../src/index.js";
import type { Anonymizer } from "../../src/index.js";

describe("Secrets Detection Integration", () => {
  let anonymizer: Anonymizer;

  afterEach(async () => {
    if (anonymizer) {
      await anonymizer.dispose();
    }
  });

  it("should not detect secrets when disabled (default)", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const text = "My API key is sk-proj-abcdefghij1234567890abcd";
    const result = await anonymizer.anonymize(text);

    const apiKeyEntities = result.entities.filter(
      (e) => e.type === PIIType.API_KEY
    );
    expect(apiKeyEntities).toHaveLength(0);
    expect(result.stats.countsByType[PIIType.API_KEY] ?? 0).toBe(0);
  });

  it("should detect API keys when secrets enabled", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = "My API key is sk-proj-abcdefghij1234567890abcd";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="API_KEY"');
    expect(result.anonymizedText).not.toContain(
      "sk-proj-abcdefghij1234567890abcd"
    );
    expect(result.stats.countsByType[PIIType.API_KEY]).toBe(1);
    expect(result.entities.some((e) => e.type === PIIType.API_KEY)).toBe(true);
  });

  it("should detect JWT tokens when secrets enabled", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text =
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="JWT"');
    expect(result.stats.countsByType[PIIType.JWT]).toBe(1);
    expect(result.entities.some((e) => e.type === PIIType.JWT)).toBe(true);
  });

  it("should detect connection strings", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text =
      "Database URL: postgres://admin:hunter2secret@db.example.com/myapp";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="CONNECTION_STRING"');
    expect(result.anonymizedText).not.toContain(
      "postgres://admin:hunter2secret@db.example.com/myapp"
    );
    expect(result.stats.countsByType[PIIType.CONNECTION_STRING]).toBe(1);
    expect(
      result.entities.some((e) => e.type === PIIType.CONNECTION_STRING)
    ).toBe(true);
  });

  it("should detect AWS access keys", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = "AWS key: AKIAIOSFODNN7EXAMPLE";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="AWS_CREDENTIALS"');
    expect(result.anonymizedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.stats.countsByType[PIIType.AWS_CREDENTIALS]).toBe(1);
    expect(
      result.entities.some((e) => e.type === PIIType.AWS_CREDENTIALS)
    ).toBe(true);
  });

  it("should detect env var secrets", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = "DATABASE_PASSWORD=supersecretvalue123";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="ENV_VAR_SECRET"');
    expect(result.anonymizedText).not.toContain(
      "DATABASE_PASSWORD=supersecretvalue123"
    );
    expect(result.stats.countsByType[PIIType.ENV_VAR_SECRET]).toBe(1);
    expect(
      result.entities.some((e) => e.type === PIIType.ENV_VAR_SECRET)
    ).toBe(true);
  });

  it("should detect config secrets in JSON", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = '{"api_key": "sk-realkey-abcdefghij1234567890"}';
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="CONFIG_SECRET"');
    expect(result.anonymizedText).not.toContain(
      "sk-realkey-abcdefghij1234567890"
    );
    expect(result.stats.countsByType[PIIType.CONFIG_SECRET]).toBe(1);
    expect(
      result.entities.some((e) => e.type === PIIType.CONFIG_SECRET)
    ).toBe(true);
  });

  it("should detect PEM private keys", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = [
      "Here is the key:",
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="PRIVATE_KEY"');
    expect(result.anonymizedText).not.toContain("BEGIN PRIVATE KEY");
    expect(result.stats.countsByType[PIIType.PRIVATE_KEY]).toBe(1);
    expect(result.entities.some((e) => e.type === PIIType.PRIVATE_KEY)).toBe(
      true
    );
  });

  it("should detect secrets alongside regular PII", async () => {
    const keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({
      keyProvider,
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text =
      "Contact support@example.com with key sk-proj-abcdefghij1234567890abcd";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    expect(result.anonymizedText).toContain('<PII type="API_KEY"');
    expect(result.anonymizedText).not.toContain("support@example.com");
    expect(result.anonymizedText).not.toContain(
      "sk-proj-abcdefghij1234567890abcd"
    );
    expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
    expect(result.stats.countsByType[PIIType.API_KEY]).toBe(1);
    expect(result.stats.totalEntities).toBeGreaterThanOrEqual(2);
  });

  it("should work with anonymize mode (irreversible)", async () => {
    anonymizer = createAnonymizer({
      mode: "anonymize",
      secrets: { enabled: true },
    });
    await anonymizer.initialize();

    const text = "My key is sk-proj-abcdefghij1234567890abcd";
    const result = await anonymizer.anonymize(text);

    expect(result.anonymizedText).toContain('<PII type="API_KEY"');
    expect(result.anonymizedText).not.toContain(
      "sk-proj-abcdefghij1234567890abcd"
    );
    expect(result.piiMap).toBeUndefined();
    expect(result.stats.countsByType[PIIType.API_KEY]).toBe(1);
  });
});
