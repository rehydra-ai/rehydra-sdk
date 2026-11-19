import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../../../dist/cli/bin.js");
const TOKEN = "cli-serve-token-0123456789";

let child: ChildProcess | null = null;

afterEach(() => {
  child?.kill("SIGTERM");
  child = null;
});

/** Starts `rehydra serve` and resolves once it prints its address. */
function startServe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn("node", [CLI, "serve", ...args], { env: { ...process.env, NO_COLOR: "1" } });
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`serve did not start:\n${stderr}`)), 15000);
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/Listening\s+(http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited with ${code}:\n${stderr}`));
    });
  });
}

describe("rehydra serve", () => {
  it("should serve health checks and anonymize with a token", async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const base = await startServe(["--ner", "disabled", "--port", String(port), "--token", TOKEN]);

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    const unauthorized = await fetch(`${base}/v1/sessions/s/anonymize`, { method: "POST" });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${base}/v1/sessions/s/anonymize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Mail jane@example.com" }),
    });
    expect(await response.json()).toEqual({ text: 'Mail <PII type="EMAIL" id="1"/>', countsByType: { EMAIL: 1 } });
  }, 30000);

  it("should refuse --db without a fixed key", async () => {
    const env = { ...process.env, NO_COLOR: "1" };
    delete env["REHYDRA_KEY"];
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const proc = spawn("node", [CLI, "serve", "--ner", "disabled", "--db", "/tmp/never-created.db"], { env });
      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      proc.on("exit", (code) => resolve({ code, stderr }));
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("needs a fixed key");
  }, 30000);
});
