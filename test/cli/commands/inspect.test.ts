import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCommand } from "../../../src/cli/commands/inspect.js";
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

describe("inspect command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-cli-inspect-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should show PII highlights with type labels", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Contact support@example.com for help.", "utf-8");

    const exitCode = await inspectCommand(inputPath, makeOptions({
      output: outputPath,
    }));

    expect(exitCode).toBe(0);

    const output = await readFile(outputPath, "utf-8");
    expect(output).toContain("EMAIL");
    expect(output).toContain("support@example.com");
  });

  it("should return exit code 2 when no PII found", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Hello world, nothing to see.", "utf-8");

    const exitCode = await inspectCommand(inputPath, makeOptions({
      output: outputPath,
    }));

    expect(exitCode).toBe(2);
  });

  it("should print stats to stderr when not quiet", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Contact support@example.com for help.", "utf-8");

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await inspectCommand(inputPath, makeOptions({
        output: outputPath,
        quiet: false,
      }));
      expect(stderrChunks.join("")).toContain("Found");
      expect(stderrChunks.join("")).toContain("EMAIL");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("should throw on invalid NER mode", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      inspectCommand(inputPath, makeOptions({ ner: "badmode" })),
    ).rejects.toThrow("Invalid NER mode");
  });

  it("should throw on unknown PII type in --types", async () => {
    const inputPath = join(testDir, "input.txt");
    await writeFile(inputPath, "test", "utf-8");

    await expect(
      inspectCommand(inputPath, makeOptions({ types: "BADTYPE" })),
    ).rejects.toThrow("Unknown PII type");
  });

  it("should filter types with --types", async () => {
    const inputPath = join(testDir, "input.txt");
    const outputPath = join(testDir, "output.txt");

    await writeFile(inputPath, "Email: test@example.com Phone: +49301234567", "utf-8");

    const exitCode = await inspectCommand(inputPath, makeOptions({
      output: outputPath,
      types: "EMAIL",
    }));

    expect(exitCode).toBe(0);
    const output = await readFile(outputPath, "utf-8");
    expect(output).toContain("EMAIL");
    expect(output).not.toContain("PHONE");
  });
});
