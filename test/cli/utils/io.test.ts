import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInput, writeOutput } from "../../../src/cli/utils/io.js";

describe("readInput", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-io-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should read from a file", async () => {
    const filePath = join(testDir, "input.txt");
    await writeFile(filePath, "hello world", "utf-8");
    const result = await readInput(filePath);
    expect(result).toBe("hello world");
  });

  it("should throw CLIError for nonexistent file", async () => {
    await expect(readInput(join(testDir, "nope.txt"))).rejects.toThrow(
      "File not found",
    );
  });

  it("should throw CLIError for unreadable file", async () => {
    const filePath = join(testDir, "noperm.txt");
    await writeFile(filePath, "secret", "utf-8");
    await chmod(filePath, 0o000);
    await expect(readInput(filePath)).rejects.toThrow("Failed to read file");
    // Restore permissions for cleanup
    await chmod(filePath, 0o644);
  });

  it("should throw CLIError when stdin is TTY and no file", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    try {
      await expect(readInput()).rejects.toThrow("No input");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});

describe("writeOutput", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-io-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should write to a file", async () => {
    const filePath = join(testDir, "output.txt");
    await writeOutput("hello", filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("hello");
  });

  it("should write to stdout when no file given", async () => {
    const origWrite = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await writeOutput("hello stdout");
      expect(chunks.join("")).toBe("hello stdout");
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
