import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anonymizeCommand } from "../../../src/cli/commands/anonymize.js";
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

describe("anonymize command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-cli-anon-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should anonymize a file and write text output", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Contact support@example.com for help.", "utf-8");

    const exitCode = await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      "pii-map": piiMapPath,
    }));

    expect(exitCode).toBe(0);

    const output = await readFile(outputPath, "utf-8");
    expect(output).toContain('<PII type="EMAIL"');
    expect(output).not.toContain("support@example.com");

    // PII map file should exist
    const piiMap = await readFile(piiMapPath, "utf-8");
    const parsed = JSON.parse(piiMap) as { version: number; key: string; piiMap: object };
    expect(parsed.version).toBe(1);
    expect(parsed.key).toBeDefined();
    expect(parsed.piiMap).toBeDefined();
  });

  it("should produce JSON output with -f json", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    const exitCode = await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      format: "json",
      "pii-map": join(testDir, "pii-map.json"),
    }));

    expect(exitCode).toBe(0);

    const raw = await readFile(outputPath, "utf-8");
    const parsed = JSON.parse(raw) as { anonymizedText: string; entities: unknown[]; stats: object };
    expect(parsed.anonymizedText).toContain('<PII type="EMAIL"');
    expect(parsed.entities.length).toBeGreaterThan(0);
    expect(parsed.stats).toBeDefined();
  });

  it("should produce NDJSON output with -f ndjson", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.ndjson");

    await writeFile(inputPath, "Email: test@example.com Phone: +49301234567", "utf-8");

    const exitCode = await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      format: "ndjson",
      "pii-map": join(testDir, "pii-map.json"),
    }));

    expect(exitCode).toBe(0);

    const raw = await readFile(outputPath, "utf-8");
    const lines = raw.trim().split("\n");
    // At least 2 entities + 1 summary
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("should return exit code 2 when no PII found", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Hello world, no PII here.", "utf-8");

    const exitCode = await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      "pii-map": join(testDir, "pii-map.json"),
    }));

    expect(exitCode).toBe(2);
  });

  it("should filter types with --types", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(
      inputPath,
      "Email: test@example.com Phone: +49301234567",
      "utf-8",
    );

    const exitCode = await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      types: "EMAIL",
      "pii-map": join(testDir, "pii-map.json"),
    }));

    expect(exitCode).toBe(0);

    const output = await readFile(outputPath, "utf-8");
    expect(output).toContain('<PII type="EMAIL"');
    // Phone should NOT be anonymized since we only requested EMAIL
    expect(output).not.toContain('<PII type="PHONE"');
  });

  it("should not save PII map in anonymize mode", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      mode: "anonymize",
      "pii-map": piiMapPath,
    }));

    // PII map file should NOT exist
    const { access } = await import("node:fs/promises");
    await expect(access(piiMapPath)).rejects.toThrow();
  });

  it("should not store key in PII map when --key is provided", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    // Generate a valid 32-byte key as base64
    const { generateKey, uint8ArrayToBase64 } = await import("../../../src/crypto/index.js");
    const key = uint8ArrayToBase64(generateKey());

    await anonymizeCommand(inputPath, makeOptions({
      output: outputPath,
      key,
      "pii-map": piiMapPath,
    }));

    const raw = await readFile(piiMapPath, "utf-8");
    const parsed = JSON.parse(raw) as { key?: string };
    expect(parsed.key).toBeUndefined();
  });

  it("should throw on invalid NER mode", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      anonymizeCommand(inputPath, makeOptions({ ner: "badmode" })),
    ).rejects.toThrow("Invalid NER mode");
  });

  it("should throw on invalid anonymization mode", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      anonymizeCommand(inputPath, makeOptions({ mode: "badmode" })),
    ).rejects.toThrow("Invalid mode");
  });

  it("should throw on invalid format", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      anonymizeCommand(inputPath, makeOptions({ format: "xml" })),
    ).rejects.toThrow("Invalid format");
  });

  it("should throw on unknown PII type", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      anonymizeCommand(inputPath, makeOptions({ types: "BADTYPE" })),
    ).rejects.toThrow("Unknown PII type");
  });

  it("should throw on empty types string", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      anonymizeCommand(inputPath, makeOptions({ types: "," })),
    ).rejects.toThrow("--types must specify at least one PII type");
  });

  it("should print PII map saved message when not quiet", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await anonymizeCommand(inputPath, makeOptions({
        output: outputPath,
        quiet: false,
        "pii-map": piiMapPath,
      }));
      expect(stderrChunks.join("")).toContain("PII map saved to");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("should print stats when verbose", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await anonymizeCommand(inputPath, makeOptions({
        output: outputPath,
        verbose: true,
        "pii-map": join(testDir, "pii-map.json"),
      }));
      expect(stderrChunks.join("")).toContain("Found");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("should use REHYDRA_KEY env var", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");
    const piiMapPath = join(testDir, "pii-map.json");

    await writeFile(inputPath, "Email: test@example.com", "utf-8");

    const { generateKey, uint8ArrayToBase64 } = await import("../../../src/crypto/index.js");
    const key = uint8ArrayToBase64(generateKey());

    const origEnv = process.env["REHYDRA_KEY"];
    process.env["REHYDRA_KEY"] = key;

    try {
      await anonymizeCommand(inputPath, makeOptions({
        output: outputPath,
        "pii-map": piiMapPath,
      }));
      const raw = await readFile(piiMapPath, "utf-8");
      const parsed = JSON.parse(raw) as { key?: string };
      // Key should not be stored when env var is used
      expect(parsed.key).toBeUndefined();
    } finally {
      if (origEnv === undefined) {
        delete process.env["REHYDRA_KEY"];
      } else {
        process.env["REHYDRA_KEY"] = origEnv;
      }
    }
  });
});
