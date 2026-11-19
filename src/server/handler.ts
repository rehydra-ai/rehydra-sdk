/**
 * Server mode: anonymize and rehydrate as a service at the boundary of a
 * sandboxed agent. The platform calls the service to anonymize data entering
 * the sandbox and to rehydrate what leaves it. The PII map, the key and
 * credential values stay with the service; the sandbox only sees placeholders.
 *
 * The handler takes and returns web-standard Request/Response objects, so it
 * runs under Node's http module (see `rehydra serve`), Bun, Deno or a worker.
 */

import { createAnonymizer, type AnonymizerConfig } from "../core/anonymizer.js";
import { CredentialStore, type CredentialConfig, type CredentialUseEvent } from "../core/credentials.js";
import type { KeyProvider } from "../crypto/index.js";
import { AnonymizerSessionImpl } from "../storage/session-base.js";
import type { PIIStorageProvider } from "../storage/types.js";
import { DEFAULT_TAG_FORMAT, NER_PII_TYPES, PIIType, type AnonymizationPolicy } from "../types/index.js";
import { buildPIISystemInstruction } from "../proxy/system-instruction.js";
import { walkJson } from "../utils/json-walk.js";

export interface RehydraServerConfig {
  /** Bearer token every /v1 request must send. */
  token: string;
  keyProvider: KeyProvider;
  /**
   * Where session PII maps live. Calls for one session are serialized within
   * this process; don't point several server processes at the same store.
   */
  piiStorageProvider: PIIStorageProvider;
  /** Anonymizer options: NER, secrets, server-wide credentials, tag format, ... */
  anonymizer?: Omit<AnonymizerConfig, "keyProvider" | "piiStorageProvider">;
  /** Default locale for anonymize calls that don't send one. */
  locale?: string;
  /** Tools whose outbound arguments keep their placeholders. `*` matches any characters. */
  redactTools?: string[];
  /** Largest accepted request body in bytes (default: 8 MiB). */
  maxBodyBytes?: number;
  /** Called after each request. Carries types and counts, never values. */
  onRequest?: (info: ServerRequestInfo) => void;
}

export interface ServerRequestInfo {
  method: string;
  route: "healthz" | "instruction" | "anonymize" | "rehydrate" | "credentials" | "delete" | "unknown";
  status: number;
  countsByType?: Record<string, number>;
}

export interface RehydraServer {
  /** Loads the NER model and credentials. Call before serving to fail at startup. */
  initialize(): Promise<void>;
  handle(request: Request): Promise<Response>;
  dispose(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ALL_TYPES = new Set<string>(Object.values(PIIType));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toolPattern(pattern: string): RegExp {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`, "i");
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Compares hashes so the time taken doesn't depend on where the strings differ. */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Send a JSON body with Content-Type: application/json");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader !== undefined) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, `Request body is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** Exactly one of `text` (a string) or `json` (any JSON value). */
function payload(body: Record<string, unknown>): { text: string } | { json: unknown } {
  const hasText = "text" in body;
  const hasJson = "json" in body;
  if (hasText === hasJson) throw new HttpError(400, "Send exactly one of text or json");
  if (hasText) {
    if (typeof body.text !== "string") throw new HttpError(400, "text must be a string");
    return { text: body.text };
  }
  return { json: body.json };
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`);
  return value;
}

function stringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new HttpError(400, `${key} must be an array of strings`);
  }
  return value;
}

/** A per-call policy that detects only the listed types (credentials are always on). */
function typesPolicy(types: string[] | undefined): Partial<AnonymizationPolicy> | undefined {
  if (types === undefined) return undefined;
  const unknown = types.filter((type) => !ALL_TYPES.has(type));
  if (unknown.length > 0) throw new HttpError(400, `Unknown PII types: ${unknown.join(", ")}`);
  const selected = new Set(types as PIIType[]);
  return {
    enabledTypes: selected,
    regexEnabledTypes: selected,
    nerEnabledTypes: new Set(NER_PII_TYPES.filter((type) => selected.has(type))),
  };
}

function addCounts(target: Record<string, number>, counts: Record<string, number>): void {
  for (const [type, count] of Object.entries(counts)) {
    if (count > 0) target[type] = (target[type] ?? 0) + count;
  }
}

/**
 * Creates the server-mode request handler.
 *
 * | Route | Purpose |
 * |---|---|
 * | `GET /healthz` | 200 once initialized (no token needed) |
 * | `GET /v1/sessions/{id}/instruction` | System instruction for the sandboxed model, listing its credentials |
 * | `POST /v1/sessions/{id}/anonymize` | `{ text } \| { json }`, optional `locale`, `types` |
 * | `POST /v1/sessions/{id}/rehydrate` | `{ text } \| { json }` with `caller: "display"` or `caller: "tool"`, `tool`, optional `target` |
 * | `PUT /v1/sessions/{id}/credentials/{name}` | Adds a credential for one session; write-only |
 * | `DELETE /v1/sessions/{id}` | Drops the session's PII map and credentials |
 */
export function createRehydraServer(config: RehydraServerConfig): RehydraServer {
  if (config.token.length < 16) {
    throw new Error("Server token must be at least 16 characters");
  }
  const maxBodyBytes = config.maxBodyBytes ?? 8 * 1024 * 1024;
  const tagFormat = config.anonymizer?.tagFormat ?? DEFAULT_TAG_FORMAT;
  const redactTools = (config.redactTools ?? []).map(toolPattern);
  const onCredentialUse = config.anonymizer?.onCredentialUse;
  const anonymizer = createAnonymizer({
    ...config.anonymizer,
    keyProvider: config.keyProvider,
    piiStorageProvider: config.piiStorageProvider,
  });
  const sessionCredentials = new Map<string, { configs: Record<string, CredentialConfig>; store: CredentialStore }>();
  let initialized = false;

  function session(id: string): AnonymizerSessionImpl {
    return new AnonymizerSessionImpl(anonymizer, id, config.piiStorageProvider, config.keyProvider);
  }

  async function putCredential(id: string, name: string, body: Record<string, unknown>): Promise<void> {
    if (anonymizer.credentialStore?.has(name) === true) {
      throw new HttpError(409, `A server-wide credential is already named ${name}`);
    }
    // Only inline values: an HTTP client must not make the server read its env or files.
    const password = body.password;
    if (typeof password !== "string" || password === "") throw new HttpError(400, "password must be a non-empty string");
    const credential: CredentialConfig = { password };
    const username = optionalString(body, "username");
    const description = optionalString(body, "description");
    const tools = stringList(body.tools, "tools");
    const hosts = stringList(body.hosts, "hosts");
    if (username !== undefined) credential.username = username;
    if (description !== undefined) credential.description = description;
    if (tools !== undefined) credential.tools = tools;
    if (hosts !== undefined) credential.hosts = hosts;

    const configs = { ...sessionCredentials.get(id)?.configs, [name]: credential };
    let store: CredentialStore;
    try {
      store = new CredentialStore(configs, { tagFormat, onUse: onCredentialUse });
      await store.load(() => Promise.reject(new Error("files are not allowed")));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    sessionCredentials.set(id, { configs, store });
  }

  async function anonymize(id: string, body: Record<string, unknown>): Promise<{ response: unknown; countsByType: Record<string, number> }> {
    const input = payload(body);
    const locale = optionalString(body, "locale") ?? config.locale;
    const policy = typesPolicy(stringList(body.types, "types"));
    const store = sessionCredentials.get(id)?.store;
    const target = session(id);
    const countsByType: Record<string, number> = {};
    const one = async (text: string): Promise<string> => {
      let value = text;
      if (store !== undefined) {
        const masked = store.mask(value);
        value = masked.text;
        addCounts(countsByType, masked.countsByType);
      }
      const result = await target.anonymize(value, locale, policy);
      addCounts(countsByType, result.stats.countsByType);
      return result.anonymizedText;
    };
    const response = "text" in input
      ? { text: await one(input.text), countsByType }
      : { json: await walkJson(input.json, one), countsByType };
    return { response, countsByType };
  }

  async function rehydrate(id: string, body: Record<string, unknown>): Promise<unknown> {
    const input = payload(body);
    const caller = body.caller;
    const target = session(id);

    if (caller === "display") {
      // Credentials are never shown; ordinary PII is restored for display.
      if (!(await target.exists())) return input;
      return "text" in input
        ? { text: await target.rehydrate(input.text) }
        : { json: await target.rehydrateJson(input.json) };
    }

    if (caller !== "tool") throw new HttpError(400, 'caller must be "display" or "tool"');
    const tool = optionalString(body, "tool");
    if (tool === undefined || tool === "") throw new HttpError(400, 'caller "tool" needs a tool name');
    const destination = optionalString(body, "target");
    if (redactTools.some((pattern) => pattern.test(tool))) return input;

    const argumentsText = "text" in input ? input.text : JSON.stringify(input.json) ?? "";
    const store = sessionCredentials.get(id)?.store;
    const restore = await target.toolCallRehydrator(
      {
        name: tool,
        // The target counts as a host the call goes to.
        arguments: destination === undefined ? argumentsText : `${argumentsText}\n${destination}`,
      },
      { credentials: store === undefined ? [] : [store] },
    );
    return "text" in input
      ? { text: restore(input.text) }
      : { json: await walkJson(input.json, (s) => Promise.resolve(restore(s))) };
  }

  async function route(request: Request): Promise<{ response: Response; info: Omit<ServerRequestInfo, "status" | "method"> }> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter((part) => part !== "");

    if (parts.length === 1 && parts[0] === "healthz") {
      if (request.method !== "GET") throw new HttpError(405, "Use GET");
      return {
        response: initialized ? json(200, { status: "ok" }) : json(503, { status: "starting" }),
        info: { route: "healthz" },
      };
    }

    if (parts[0] !== "v1" || parts[1] !== "sessions" || parts.length < 3) {
      throw new HttpError(404, "Not found");
    }
    const authorization = request.headers.get("authorization") ?? "";
    const given = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!(await tokenMatches(given, config.token))) throw new HttpError(401, "Missing or wrong bearer token");
    if (!initialized) await server.initialize();

    const id = decodeURIComponent(parts[2]!);
    if (!SESSION_ID.test(id)) throw new HttpError(400, "Session IDs use letters, digits, '.', '_', ':' and '-' (at most 128)");
    const action = parts[3];

    if (parts.length === 3) {
      if (request.method !== "DELETE") throw new HttpError(405, "Use DELETE");
      await session(id).delete();
      sessionCredentials.delete(id);
      return { response: new Response(null, { status: 204 }), info: { route: "delete" } };
    }
    if (parts.length === 4 && action === "instruction") {
      if (request.method !== "GET") throw new HttpError(405, "Use GET");
      const credentials = [
        ...(anonymizer.credentialStore?.describe() ?? []),
        ...(sessionCredentials.get(id)?.store.describe() ?? []),
      ];
      return {
        response: json(200, { instruction: buildPIISystemInstruction(tagFormat, credentials) }),
        info: { route: "instruction" },
      };
    }
    if (parts.length === 4 && action === "anonymize") {
      if (request.method !== "POST") throw new HttpError(405, "Use POST");
      const { response, countsByType } = await anonymize(id, await readJson(request, maxBodyBytes));
      return { response: json(200, response), info: { route: "anonymize", countsByType } };
    }
    if (parts.length === 4 && action === "rehydrate") {
      if (request.method !== "POST") throw new HttpError(405, "Use POST");
      return { response: json(200, await rehydrate(id, await readJson(request, maxBodyBytes))), info: { route: "rehydrate" } };
    }
    if (parts.length === 5 && action === "credentials") {
      if (request.method !== "PUT") throw new HttpError(405, "Use PUT");
      await putCredential(id, decodeURIComponent(parts[4]!), await readJson(request, maxBodyBytes));
      return { response: new Response(null, { status: 204 }), info: { route: "credentials" } };
    }
    throw new HttpError(404, "Not found");
  }

  const server: RehydraServer = {
    async initialize(): Promise<void> {
      if (initialized) return;
      await anonymizer.initialize();
      initialized = true;
    },

    async handle(request: Request): Promise<Response> {
      let response: Response;
      let info: Omit<ServerRequestInfo, "status" | "method"> = { route: "unknown" };
      try {
        ({ response, info } = await route(request));
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : "Internal error";
        response = json(status, { error: { message } });
      }
      config.onRequest?.({ method: request.method, status: response.status, ...info });
      return response;
    },

    async dispose(): Promise<void> {
      sessionCredentials.clear();
      await anonymizer.dispose();
      initialized = false;
    },
  };
  return server;
}

export type { CredentialUseEvent };
