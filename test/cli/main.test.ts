import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { run } from "../../src/cli/main.js";

describe("run()", () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let origStdoutWrite: typeof process.stdout.write;
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    origStdoutWrite = process.stdout.write;
    origStderrWrite = process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    vi.restoreAllMocks();
  });

  it("should show help with --help", async () => {
    const exitCode = await run(["--help"]);
    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("rehydra");
    expect(output).toContain("COMMANDS");
    expect(output).toContain("anonymize");
  });

  it("should show help with -h", async () => {
    const exitCode = await run(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("")).toContain("COMMANDS");
  });

  it("should show version with --version", async () => {
    const exitCode = await run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("")).toMatch(/rehydra \d+\.\d+\.\d+/);
  });

  it("should show version with -V", async () => {
    const exitCode = await run(["-V"]);
    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("")).toMatch(/rehydra \d+/);
  });

  it("should show help when no arguments given", async () => {
    const exitCode = await run([]);
    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("")).toContain("COMMANDS");
  });

  it("should return 1 for unknown command", async () => {
    const exitCode = await run(["foobar"]);
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("Unknown command");
  });

  it("should return 1 for unknown flag", async () => {
    const exitCode = await run(["--badopt"]);
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("Error");
  });

  it("should handle --no-color flag", async () => {
    const exitCode = await run(["--no-color", "--help"]);
    expect(exitCode).toBe(0);
    // Help text should not contain ANSI escape sequences
    const output = stdoutChunks.join("");
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("should show proxy command in help", async () => {
    const exitCode = await run(["--help"]);
    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("proxy <provider>");
    expect(output).toContain("--port");
    expect(output).toContain("--upstream");
  });

  it("should dispatch proxy command (missing provider error)", async () => {
    // Proxy command throws CLIError when no provider given,
    // which propagates to the caller (bin.ts catches it)
    await expect(run(["proxy"])).rejects.toThrow("Missing provider argument");
  });

  it("should accept -p as short flag for --port", async () => {
    // Validates -p is accepted by parseArgs without a parse error (would throw "Unknown option" otherwise).
    // With no provider, proxyCommand throws CLIError — that's fine, the flag was accepted.
    await expect(run(["proxy", "-p", "9090"])).rejects.toThrow("Missing provider argument");
  });
});
