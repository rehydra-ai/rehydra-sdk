import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../../../dist/cli/bin.js");

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCLI(
  args: string[],
  options?: { input?: string; env?: Record<string, string> },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], {
      env: { ...process.env, ...options?.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    if (options?.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

describe("CLI integration", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-cli-int-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  describe("--help and --version", () => {
    it("should display help", async () => {
      const result = await runCLI(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("rehydra");
      expect(result.stdout).toContain("COMMANDS");
      expect(result.stdout).toContain("anonymize");
      expect(result.stdout).toContain("rehydrate");
      expect(result.stdout).toContain("inspect");
    });

    it("should display version", async () => {
      const result = await runCLI(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/rehydra \d+\.\d+\.\d+/);
    });

    it("should show help when no command given", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("COMMANDS");
    });
  });

  describe("anonymize", () => {
    it("should anonymize a file", async () => {
      const inputPath = join(testDir, "input.txt");
      const outputPath = join(testDir, "output.txt");
      const piiMapPath = join(testDir, "pii.json");

      await writeFile(inputPath, "Contact test@example.com please.");

      const result = await runCLI([
        "anonymize", inputPath,
        "-o", outputPath,
        "--pii-map", piiMapPath,
        "-q",
      ]);

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      const output = await readFile(outputPath, "utf-8");
      expect(output).toContain('<PII type="EMAIL"');
      expect(output).not.toContain("test@example.com");
    });

    it("should anonymize from stdin", async () => {
      const piiMapPath = join(testDir, "pii.json");
      const result = await runCLI(
        ["anonymize", "--pii-map", piiMapPath, "-q"],
        { input: "Email john@test.org today." },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('<PII type="EMAIL"');
      expect(result.stdout).not.toContain("john@test.org");
    });

    it("should output JSON format", async () => {
      const piiMapPath = join(testDir, "pii.json");
      const result = await runCLI(
        ["anonymize", "-f", "json", "--pii-map", piiMapPath, "-q"],
        { input: "Email: user@example.com" },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as { anonymizedText: string; entities: unknown[] };
      expect(parsed.anonymizedText).toContain("PII");
      expect(parsed.entities.length).toBeGreaterThan(0);
    });

    it("should return exit code 2 when no PII found", async () => {
      const piiMapPath = join(testDir, "pii.json");
      const result = await runCLI(
        ["anonymize", "--pii-map", piiMapPath, "-q"],
        { input: "Hello world, nothing sensitive." },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(2);
    });
  });

  describe("rehydrate", () => {
    it("should round-trip anonymize then rehydrate", async () => {
      const original = "Contact admin@corp.com for access.";
      const inputPath = join(testDir, "input.txt");
      const anonPath = join(testDir, "anon.txt");
      const rehydratedPath = join(testDir, "rehydrated.txt");
      const piiMapPath = join(testDir, "pii.json");

      await writeFile(inputPath, original);

      // Anonymize
      const anonResult = await runCLI([
        "anonymize", inputPath,
        "-o", anonPath,
        "--pii-map", piiMapPath,
        "-q",
      ]);
      expect(anonResult.exitCode, `anonymize stderr: ${anonResult.stderr}`).toBe(0);

      // Rehydrate
      const result = await runCLI([
        "rehydrate", anonPath,
        "-o", rehydratedPath,
        "--pii-map", piiMapPath,
      ]);

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      const rehydrated = (await readFile(rehydratedPath, "utf-8")).trim();
      expect(rehydrated).toBe(original);
    });
  });

  describe("inspect", () => {
    it("should show detected PII", async () => {
      const result = await runCLI(
        ["inspect", "-q"],
        { input: "Email support@example.com for help." },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("EMAIL");
      expect(result.stdout).toContain("support@example.com");
    });
  });

  describe("--types with --secrets", () => {
    it("should detect secrets when both --types and --secrets are used", async () => {
      const piiMapPath = join(testDir, "pii.json");
      // Input with both an email (--types EMAIL) and a secret (--secrets)
      const input = "Contact test@example.com\nAPI_KEY=sk-proj-1234567890abcdef";
      const result = await runCLI(
        ["anonymize", "--types", "EMAIL", "--secrets", "--pii-map", piiMapPath, "-q"],
        { input },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      // Email should be anonymized
      expect(result.stdout).toContain('<PII type="EMAIL"');
      expect(result.stdout).not.toContain("test@example.com");
      // Secret should also be anonymized
      expect(result.stdout).not.toContain("sk-proj-1234567890abcdef");
    });

    it("should detect secrets in inspect when both --types and --secrets are used", async () => {
      const input = "Contact test@example.com\nAPI_KEY=sk-proj-1234567890abcdef";
      const result = await runCLI(
        ["inspect", "--types", "EMAIL", "--secrets", "-q"],
        { input },
      );

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      // Both EMAIL and secret types should be detected
      expect(result.stdout).toContain("EMAIL");
      expect(result.stdout).toContain("sk-proj-1234567890abcdef");
    });
  });

  describe("error handling", () => {
    it("should error on unknown command", async () => {
      const result = await runCLI(["foobar"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command");
    });

    it("should error on missing file", async () => {
      const result = await runCLI(["anonymize", "/nonexistent/file.txt", "-q"]);
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown flag", async () => {
      const result = await runCLI(["anonymize", "--badopt"]);
      expect(result.exitCode).toBe(1);
    });
  });
});
