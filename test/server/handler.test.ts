import { describe, it, expect, beforeEach } from "vitest";
import { createRehydraServer, type RehydraServer, type ServerRequestInfo } from "../../src/server/index.js";
import { InMemoryKeyProvider } from "../../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";
import type { CredentialUseEvent } from "../../src/core/credentials.js";

const TOKEN = "test-token-0123456789abcdef";
const GLOBAL_PW = "global-Secret-pw";
const SESSION_PW = "session-Secret-pw";

let server: RehydraServer;
let storage: InMemoryPIIStorageProvider;
let requests: ServerRequestInfo[];
let credentialEvents: CredentialUseEvent[];

function call(method: string, path: string, body?: unknown, token = TOKEN): Promise<Response> {
  return server.handle(
    new Request(`http://rehydra${path}`, {
      method,
      headers: {
        ...(token === "" ? {} : { Authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function post(path: string, body: unknown): Promise<any> {
  const response = await call("POST", path, body);
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  storage = new InMemoryPIIStorageProvider();
  requests = [];
  credentialEvents = [];
  server = createRehydraServer({
    token: TOKEN,
    keyProvider: new InMemoryKeyProvider(),
    piiStorageProvider: storage,
    redactTools: ["web_*"],
    anonymizer: {
      ner: { mode: "disabled" },
      secrets: { enabled: true },
      credentials: { deploy: { password: GLOBAL_PW, tools: ["shell"] } },
      onCredentialUse: (event) => credentialEvents.push(event),
    },
    onRequest: (info) => requests.push(info),
  });
  await server.initialize();
});

describe("server mode", () => {
  it("should answer health checks without a token", async () => {
    const response = await call("GET", "/healthz", undefined, "");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it.each([
    ["no token", ""],
    ["a wrong token", "test-token-0123456789abcdeX"],
  ])("should reject %s", async (_label, token) => {
    const response = await call("POST", "/v1/sessions/s1/anonymize", { text: "hi" }, token);
    expect(response.status).toBe(401);
  });

  it("should anonymize text and report counts only", async () => {
    const result = await post("/v1/sessions/s1/anonymize", { text: "Mail jane@example.com" });

    expect(result).toEqual({ text: 'Mail <PII type="EMAIL" id="1"/>', countsByType: { EMAIL: 1 } });
    expect(JSON.stringify(requests)).not.toContain("jane");
    expect(requests[0]).toMatchObject({ route: "anonymize", status: 200, countsByType: { EMAIL: 1 } });
  });

  it("should anonymize JSON and keep IDs across calls", async () => {
    await post("/v1/sessions/s1/anonymize", { text: "Mail jane@example.com" });
    const result = await post("/v1/sessions/s1/anonymize", {
      json: { to: "jane@example.com", cc: ["bob@example.com"], n: 3 },
    });

    expect(result.json).toEqual({
      to: '<PII type="EMAIL" id="1"/>',
      cc: ['<PII type="EMAIL" id="2"/>'],
      n: 3,
    });
  });

  it("should detect only the requested types", async () => {
    const result = await post("/v1/sessions/s1/anonymize", {
      text: "jane@example.com uses sk-proj-abc123xyz789testkeyvalue",
      types: ["API_KEY"],
    });

    expect(result.text).toBe('jane@example.com uses <PII type="API_KEY" id="1"/>');
  });

  it("should reject unknown types", async () => {
    const response = await call("POST", "/v1/sessions/s1/anonymize", { text: "x", types: ["NOPE"] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: "Unknown PII types: NOPE" } });
  });

  it("should restore ordinary PII for display but never credentials", async () => {
    const masked = await post("/v1/sessions/s1/anonymize", { text: `jane@example.com ${GLOBAL_PW}` });

    const result = await post("/v1/sessions/s1/rehydrate", { text: masked.text, caller: "display" });

    expect(result.text).toBe('jane@example.com <PII type="PASSWORD" id="deploy"/>');
  });

  it("should fill in credentials for allowed tools only", async () => {
    const tag = '<PII type="PASSWORD" id="deploy"/>';

    const allowed = await post("/v1/sessions/s1/rehydrate", { json: { cmd: `login ${tag}` }, caller: "tool", tool: "shell" });
    const refused = await post("/v1/sessions/s1/rehydrate", { text: tag, caller: "tool", tool: "send_email" });
    const redacted = await post("/v1/sessions/s1/rehydrate", { text: tag, caller: "tool", tool: "web_fetch" });

    expect(allowed.json).toEqual({ cmd: `login ${GLOBAL_PW}` });
    expect(refused.text).toBe(tag);
    expect(redacted.text).toBe(tag);
    expect(credentialEvents).toEqual([
      { credential: "deploy", tool: "shell", restored: true },
      { credential: "deploy", tool: "send_email", restored: false, reason: "tool-not-allowed" },
    ]);
  });

  describe("session credentials", () => {
    const tag = '<PII type="PASSWORD" id="crm"/>';

    beforeEach(async () => {
      const response = await call("PUT", "/v1/sessions/s1/credentials/crm", {
        username: "agent",
        password: SESSION_PW,
        description: "CRM login",
        hosts: ["crm.example.com"],
      });
      expect(response.status).toBe(204);
    });

    it("should list them in the session's instruction, without values", async () => {
      const response = await call("GET", "/v1/sessions/s1/instruction");
      const { instruction } = (await response.json()) as { instruction: string };

      expect(instruction).toContain(`- crm (CRM login): username <PII type="USERNAME" id="crm"/>, password ${tag}.`);
      expect(instruction).toContain('- deploy: password <PII type="PASSWORD" id="deploy"/>.');
      expect(instruction).not.toContain(SESSION_PW);
      expect(instruction).not.toContain(GLOBAL_PW);
    });

    it("should mask their echoes and keep other sessions unaffected", async () => {
      const own = await post("/v1/sessions/s1/anonymize", { text: `pw=${SESSION_PW}` });
      const other = await post("/v1/sessions/s2/anonymize", { text: `pw=${SESSION_PW}` });

      expect(own).toEqual({ text: `pw=${tag}`, countsByType: { PASSWORD: 1 } });
      expect(other.text).toBe(`pw=${SESSION_PW}`);
    });

    it("should check hosts, counting the target", async () => {
      const toTarget = await post("/v1/sessions/s1/rehydrate", {
        json: { password: tag },
        caller: "tool",
        tool: "http_request",
        target: "https://crm.example.com/login",
      });
      const elsewhere = await post("/v1/sessions/s1/rehydrate", {
        json: { password: tag },
        caller: "tool",
        tool: "http_request",
        target: "https://evil.example/collect",
      });

      expect(toTarget.json).toEqual({ password: SESSION_PW });
      expect(elsewhere.json).toEqual({ password: tag });
    });

    it("should refuse values from env vars or files, and names taken server-wide", async () => {
      const fromEnv = await call("PUT", "/v1/sessions/s1/credentials/x", { password: { env: "HOME" } });
      const taken = await call("PUT", "/v1/sessions/s1/credentials/deploy", { password: "other-pw" });
      const badName = await call("PUT", "/v1/sessions/s1/credentials/crm-prod", { password: "other-pw" });

      expect(fromEnv.status).toBe(400);
      expect(taken.status).toBe(409);
      expect(badName.status).toBe(400);
    });

    it("should drop the session's map and credentials on DELETE", async () => {
      await post("/v1/sessions/s1/anonymize", { text: "jane@example.com" });

      const response = await call("DELETE", "/v1/sessions/s1");

      expect(response.status).toBe(204);
      expect(await storage.exists("s1")).toBe(false);
      const after = await post("/v1/sessions/s1/anonymize", { text: `pw=${SESSION_PW}` });
      expect(after.text).toBe(`pw=${SESSION_PW}`);
    });
  });

  it("should give unique IDs to parallel calls on one session", async () => {
    const emails = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    const results = await Promise.all(emails.map((email) => post("/v1/sessions/p/anonymize", { text: email })));

    const restored = await Promise.all(
      results.map((result: { text: string }) => post("/v1/sessions/p/rehydrate", { text: result.text, caller: "display" })),
    );
    expect(restored.map((result: { text: string }) => result.text)).toEqual(emails);
  });

  it.each([
    ["an unknown route", "GET", "/v1/sessions/s1/nope", undefined, 404],
    ["a wrong method", "GET", "/v1/sessions/s1/anonymize", undefined, 405],
    ["a bad session ID", "POST", "/v1/sessions/a%2Fb/anonymize", { text: "x" }, 400],
    ["both text and json", "POST", "/v1/sessions/s1/anonymize", { text: "x", json: {} }, 400],
    ["a missing caller", "POST", "/v1/sessions/s1/rehydrate", { text: "x" }, 400],
    ["a tool caller without a tool", "POST", "/v1/sessions/s1/rehydrate", { text: "x", caller: "tool" }, 400],
  ])("should reject %s", async (_label, method, path, body, status) => {
    const response = await call(method, path, body);
    expect(response.status).toBe(status);
  });

  it.each([
    ["a non-JSON content type", "text/plain", "hello", 415],
    ["invalid JSON", "application/json", "{", 400],
    ["a JSON array", "application/json", "[]", 400],
    ["a non-string text", "application/json", '{"text": 3}', 400],
  ])("should reject %s", async (_label, contentType, body, status) => {
    const response = await server.handle(
      new Request("http://rehydra/v1/sessions/s1/anonymize", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType },
        body,
      }),
    );
    expect(response.status).toBe(status);
  });

  it("should return display input unchanged for a session with no map", async () => {
    const result = await post("/v1/sessions/unknown/rehydrate", { json: { a: '<PII type="EMAIL" id="1"/>' }, caller: "display" });
    expect(result).toEqual({ json: { a: '<PII type="EMAIL" id="1"/>' } });
  });

  it("should report starting until initialized, then initialize on the first call", async () => {
    const lazy = createRehydraServer({
      token: TOKEN,
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      anonymizer: { ner: { mode: "disabled" } },
    });
    const health = () => lazy.handle(new Request("http://rehydra/healthz"));

    expect((await health()).status).toBe(503);
    const response = await lazy.handle(
      new Request("http://rehydra/v1/sessions/s/anonymize", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "jane@example.com" }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await health()).status).toBe(200);
    await lazy.dispose();
    expect((await health()).status).toBe(503);
  });

  it.each([
    ["POST", "/healthz"],
    ["POST", "/v1/sessions/s1"],
    ["POST", "/v1/sessions/s1/instruction"],
    ["POST", "/v1/sessions/s1/credentials/crm"],
  ])("should reject %s %s with 405", async (method, path) => {
    expect((await call(method, path, {})).status).toBe(405);
  });

  it("should reject oversized bodies", async () => {
    const small = createRehydraServer({
      token: TOKEN,
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      anonymizer: { ner: { mode: "disabled" } },
      maxBodyBytes: 100,
    });
    const response = await small.handle(
      new Request("http://rehydra/v1/sessions/s1/anonymize", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(200) }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("should refuse short tokens", () => {
    expect(() =>
      createRehydraServer({
        token: "short",
        keyProvider: new InMemoryKeyProvider(),
        piiStorageProvider: new InMemoryPIIStorageProvider(),
      }),
    ).toThrow(/at least 16/);
  });
});
