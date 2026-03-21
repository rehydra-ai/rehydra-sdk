import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anonymizeCommand } from "../../../src/cli/commands/anonymize.js";
import { rehydrateCommand } from "../../../src/cli/commands/rehydrate.js";
import type { ParsedOptions } from "../../../src/cli/main.js";

function makeOptions(overrides?: Partial<ParsedOptions>): ParsedOptions {
  return {
    format: "text",
    ner: "disabled",
    "pii-map": ".rehydra-pii-map.json",
    mode: "pseudonymize",
    verbose: false,
    quiet: true,
    ...overrides,
  };
}

describe("rehydrate command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-cli-rehydrate-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should round-trip anonymize then rehydrate", async () => {
    const originalText = "Contact support@example.com or call +49301234567 for help.";
    const inputPath = join(testDir, "input.txt");
    const anonPath = join(testDir, "anonymized.txt");
    const rehydratedPath = join(testDir, "rehydrated.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, originalText, "utf-8");

    // Anonymize
    const anonExit = await anonymizeCommand(inputPath, makeOptions({
      output: anonPath,
      "pii-map": piiMapPath,
    }));
    expect(anonExit).toBe(0);

    // Verify anonymized output doesn't contain PII
    const anonContent = await readFile(anonPath, "utf-8");
    expect(anonContent).not.toContain("support@example.com");

    // Rehydrate
    const rehydrateExit = await rehydrateCommand(anonPath, makeOptions({
      output: rehydratedPath,
      "pii-map": piiMapPath,
    }));
    expect(rehydrateExit).toBe(0);

    // Verify rehydrated output matches original
    const rehydrated = (await readFile(rehydratedPath, "utf-8")).trim();
    expect(rehydrated).toBe(originalText);
  });

  it("should rehydrate with external key", async () => {
    const originalText = "Email: admin@corp.com";
    const inputPath = join(testDir, "input.txt");
    const anonPath = join(testDir, "anonymized.txt");
    const rehydratedPath = join(testDir, "rehydrated.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, originalText, "utf-8");

    // Generate a key to use for both commands
    const { generateKey, uint8ArrayToBase64 } = await import("../../../src/crypto/index.js");
    const key = uint8ArrayToBase64(generateKey());

    // Anonymize with external key
    await anonymizeCommand(inputPath, makeOptions({
      output: anonPath,
      key,
      "pii-map": piiMapPath,
    }));

    // Rehydrate with same external key
    const exitCode = await rehydrateCommand(anonPath, makeOptions({
      output: rehydratedPath,
      key,
      "pii-map": piiMapPath,
    }));

    expect(exitCode).toBe(0);
    const rehydrated = (await readFile(rehydratedPath, "utf-8")).trim();
    expect(rehydrated).toBe(originalText);
  });

  it("should fail with wrong key", async () => {
    const inputPath = join(testDir, "input.txt");
    const anonPath = join(testDir, "anonymized.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    const { generateKey, uint8ArrayToBase64 } = await import("../../../src/crypto/index.js");

    // Anonymize with one key
    const key1 = uint8ArrayToBase64(generateKey());
    await anonymizeCommand(inputPath, makeOptions({
      output: anonPath,
      key: key1,
      "pii-map": piiMapPath,
    }));

    // Try to rehydrate with a different key
    const key2 = uint8ArrayToBase64(generateKey());
    await expect(
      rehydrateCommand(anonPath, makeOptions({
        output: join(testDir, "rehydrated.txt"),
        key: key2,
        "pii-map": piiMapPath,
      })),
    ).rejects.toThrow("Failed to decrypt");
  });

  it("should fail when PII map file is missing", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "some text", "utf-8");

    await expect(
      rehydrateCommand(inputPath, makeOptions({
        "pii-map": join(testDir, "nonexistent.json"),
      })),
    ).rejects.toThrow("PII map file not found");
  });
});
