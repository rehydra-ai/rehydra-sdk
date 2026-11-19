import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { request } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveCommand } from "../../../src/cli/commands/serve.js";
import type { ParsedOptions } from "../../../src/cli/main.js";
import { CLIError } from "../../../src/cli/utils/errors.js";
import { setNoColor } from "../../../src/cli/utils/color.js";

const TOKEN = "serve-command-token-0123456789";

function options(overrides: Partial<ParsedOptions> = {}): ParsedOptions {
  return {
    format: "text",
    ner: "disabled",
    "pii-map": ".rehydra-pii-map.json",
    mode: "pseudonymize",
    secrets: false,
    verbose: false,
    quiet: false,
    ...overrides,
  };
}

function randomPort(): string {
  return String(20000 + Math.floor(Math.random() * 20000));
}

let stderr: string;
let dir: string;

beforeEach(() => {
  setNoColor(true);
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  });
  dir = mkdtempSync(join(tmpdir(), "rehydra-serve-cmd-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Starts serveCommand, waits for its banner, and returns a stop function. */
async function start(opts: ParsedOptions): Promise<() => Promise<number>> {
  const running = serveCommand(opts);
  for (let i = 0; i < 200 && !stderr.includes("Ctrl+C to stop"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(stderr).toContain("Ctrl+C to stop");
  return async () => {
    process.emit("SIGTERM");
    return running;
  };
}

function overSocket(socketPath: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ socketPath, path, method: "GET" }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject).end();
  });
}

describe("serveCommand", () => {
  it("should serve on a port, log requests and credential use, and stop on SIGTERM", async () => {
    const port = randomPort();
    const credentials = join(dir, "credentials.json");
    writeFileSync(credentials, JSON.stringify({ deploy: { password: "deploy-Secret-pw", tools: ["shell"] } }));
    const stop = await start(options({ port, token: TOKEN, verbose: true, credentials, "redact-tools": "web_*, ," }));
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const anonymized = await fetch(`${base}/v1/sessions/s/anonymize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Mail jane@example.com" }),
    });
    expect(await anonymized.json()).toMatchObject({ text: 'Mail <PII type="EMAIL" id="1"/>' });
    for (const tool of ["shell", "mail"]) {
      await fetch(`${base}/v1/sessions/s/rehydrate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: '<PII type="PASSWORD" id="deploy"/>', caller: "tool", tool }),
      });
    }
    await fetch(`${base}/v1/sessions/s/nope`, { headers });

    expect(await stop()).toBe(0);
    expect(stderr).toContain(`Listening   http://127.0.0.1:${port}`);
    expect(stderr).toContain("Credentials deploy");
    expect(stderr).toContain("Token       configured");
    expect(stderr).toContain("POST anonymize → 200 1 EMAIL");
    expect(stderr).toContain("GET unknown → 404");
    expect(stderr).toContain("credential deploy → filled in for shell");
    expect(stderr).toContain("credential deploy → kept placeholder for mail (tool not allowed)");
    expect(stderr).not.toContain("deploy-Secret-pw");
    expect(stderr).not.toContain("jane");
  });

  it("should listen on a Unix socket and print a generated token", async () => {
    const socket = join(dir, "rehydra.sock");
    writeFileSync(socket, "stale");
    const stop = await start(options({ socket }));

    expect(await overSocket(socket, "/healthz")).toBe(200);
    expect(await overSocket(socket, "/v1/sessions/s/instruction")).toBe(401);

    expect(await stop()).toBe(0);
    expect(stderr).toContain(`Listening   ${socket}`);
    expect(stderr).toMatch(/Token {7}\S{20,} \(generated/);
  });

  it("should keep session maps in SQLite with --db and --key", async () => {
    const db = join(dir, "pii.db");
    const port = randomPort();
    const stop = await start(options({ port, token: TOKEN, db, key: Buffer.alloc(32, 7).toString("base64") }));

    await fetch(`http://127.0.0.1:${port}/v1/sessions/s/anonymize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Mail jane@example.com" }),
    });

    expect(await stop()).toBe(0);
    expect(stderr).toContain(`Storage     ${db}`);
    expect(existsSync(db)).toBe(true);
  });

  it("should print nothing with --quiet", async () => {
    const port = randomPort();
    const running = serveCommand(options({ port, token: TOKEN, quiet: true }));
    // Once it answers, its signal handlers are registered.
    for (let i = 0; i < 200; i++) {
      const ok = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok, () => false);
      if (ok) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    process.emit("SIGTERM");

    expect(await running).toBe(0);
    expect(stderr).toBe("");
  });

  it.each([
    ["an invalid port", { port: "99999" }, "Invalid port"],
    ["an invalid NER mode", { port: randomPort(), ner: "huge" }, "Invalid NER mode"],
    ["--db without a key", { db: "/tmp/never.db" }, "needs a fixed key"],
    ["a short token", { port: randomPort(), token: "short" }, "at least 16"],
  ])("should refuse %s", async (_label, overrides, message) => {
    const previousKey = process.env["REHYDRA_KEY"];
    delete process.env["REHYDRA_KEY"];
    try {
      const error = await serveCommand(options(overrides)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CLIError);
      expect((error as Error).message).toContain(message);
    } finally {
      if (previousKey !== undefined) process.env["REHYDRA_KEY"] = previousKey;
    }
  });
});
