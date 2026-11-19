/**
 * Credential store: named usernames and passwords that an agent can use in
 * tool calls without the values entering the conversation.
 *
 * The model only ever sees named placeholders such as
 * `<PII type="PASSWORD" id="github"/>`. Real values are restored only inside
 * the arguments of tool calls the credential allows. They are never written
 * to a PII map or session storage, so ordinary rehydration (assistant text,
 * `rehydrate()`, stored maps) leaves them as placeholders.
 */

import { PIIType, DetectionSource, type SpanMatch, type TagFormat, DEFAULT_TAG_FORMAT } from "../types/index.js";
import type { Recognizer } from "../recognizers/base.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
import { createPIIMapKey, extractTags, generateTag } from "../pipeline/tagger.js";
import { uint8ArrayToBase64 } from "../crypto/pii-map-crypto.js";

/** A credential value: inline, from an environment variable, or from a file. */
export type CredentialSource = string | { env: string } | { file: string };

export interface CredentialConfig {
  /** Optional username. Masked and restored like the password. */
  username?: CredentialSource;
  password: CredentialSource;
  /** Shown to the model so it knows what the credential is for. Never include the value. */
  description?: string;
  /**
   * Tools whose arguments may receive the real values. `*` matches any
   * characters; matching ignores case. Omit to allow every tool.
   */
  tools?: string[];
  /**
   * Hosts the credential may be sent to. When set, a tool call only receives
   * the real values if it names at least one URL or `user@host:` target and
   * every host it names is in this list (subdomains included).
   */
  hosts?: string[];
}

/** Credentials by name. Names use lowercase letters and digits and start with a letter. */
export type CredentialsConfig = Record<string, CredentialConfig>;

/** Reported for every credential a tool call refers to. Contains names only, never values. */
export interface CredentialUseEvent {
  credential: string;
  tool: string;
  /** Whether the real values were filled in. */
  restored: boolean;
  /** Why the values were withheld. */
  reason?: "tool-not-allowed" | "host-not-allowed";
}

/** What the model is told about a credential. */
export interface CredentialDescription {
  name: string;
  description?: string;
  hasUsername: boolean;
  tools?: string[];
  hosts?: string[];
}

export interface CredentialToolCall {
  /** Tool name as the client reports it. */
  name: string;
  /** The tool call's arguments, with ordinary PII already restored, used for host checks. */
  arguments: string;
}

interface CredentialForm {
  type: PIIType;
  id: string;
  value: string;
}

interface LoadedCredential {
  name: string;
  config: CredentialConfig;
  forms: CredentialForm[];
  ids: Set<string>;
  tools: RegExp[] | null;
}

const NAME_PATTERN = /^[a-z][a-z0-9]*$/;
/** Shorter values would be masked wherever those characters appear. */
const MIN_MASKED_LENGTH = 4;

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64(value: string): string {
  return uint8ArrayToBase64(toBytes(value));
}

/**
 * The forms a value can echo back in, each with its own placeholder ID so it
 * is restored in the same encoding: `github`, `githubb64`, `githubbasic`, ...
 */
function credentialForms(name: string, password: string, username?: string): CredentialForm[] {
  const forms: CredentialForm[] = [{ type: PIIType.PASSWORD, id: name, value: password }];
  const seen = new Set([password]);
  const add = (suffix: string, value: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    forms.push({ type: PIIType.PASSWORD, id: `${name}${suffix}`, value });
  };
  const b64 = base64(password);
  add("b64", b64);
  add("b64url", b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  add("url", encodeURIComponent(password));
  add("hex", Array.from(toBytes(password), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  add("json", JSON.stringify(password).slice(1, -1));
  if (username !== undefined) {
    forms.push({ type: PIIType.USERNAME, id: name, value: username });
    // HTTP Basic auth, as printed by `curl -v`
    add("basic", base64(`${username}:${password}`));
  }
  return forms;
}

function toolPattern(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i");
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>\\]+/gi;
/** scp-style Git remotes: git@github.com:org/repo.git */
const SCP_PATTERN = /\b[\w.-]+@([a-z0-9.-]+\.[a-z]{2,}):/gi;

/** Hosts a tool call's arguments point at. */
export function targetHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase();
      if (host !== "") hosts.add(host);
    } catch {
      // Not a parseable URL
    }
  }
  for (const match of text.matchAll(SCP_PATTERN)) {
    if (match[1] !== undefined) hosts.add(match[1].toLowerCase());
  }
  return [...hosts];
}

function withoutTags(text: string, tags: ReadonlyArray<{ position: number; matchedText: string }>): string {
  let result = text;
  for (const tag of [...tags].sort((a, b) => b.position - a.position)) {
    result = result.slice(0, tag.position) + "x" + result.slice(tag.position + tag.matchedText.length);
  }
  return result;
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const domain = entry.toLowerCase().replace(/^\*\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  });
}

async function resolveSource(
  name: string,
  field: string,
  source: CredentialSource,
  readFile: (path: string) => Promise<string>,
): Promise<string> {
  let value: string | undefined;
  if (typeof source === "string") {
    value = source;
  } else if ("env" in source) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    value = env?.[source.env];
    if (value === undefined || value === "") {
      throw new Error(`Credential "${name}": environment variable ${source.env} for its ${field} is not set`);
    }
  } else {
    try {
      // Files usually end with a newline that isn't part of the secret.
      value = (await readFile(source.file)).replace(/\r?\n$/, "");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Credential "${name}": could not read its ${field} from ${source.file}: ${reason}`);
    }
  }
  if (value === "") throw new Error(`Credential "${name}": its ${field} is empty`);
  return value;
}

export class CredentialStore {
  private loaded: LoadedCredential[] = [];
  private lookup: RawPIIMap = new Map();

  constructor(
    private readonly config: CredentialsConfig,
    private readonly options: {
      tagFormat?: TagFormat;
      onUse?: (event: CredentialUseEvent) => void;
    } = {},
  ) {
    for (const [name, credential] of Object.entries(config)) {
      if (!NAME_PATTERN.test(name)) {
        throw new Error(
          `Credential name "${name}" is invalid: use lowercase letters and digits, starting with a letter ` +
            `(for example "${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "github"}").`,
        );
      }
      if ((credential as Partial<CredentialConfig>).password === undefined) {
        throw new Error(`Credential "${name}" needs a password`);
      }
    }
  }

  /** Whether any credentials are configured. */
  get size(): number {
    return Object.keys(this.config).length;
  }

  /** Resolves the configured values. Call before anonymizing or restoring. */
  async load(readFile: (path: string) => Promise<string>): Promise<void> {
    const loaded: LoadedCredential[] = [];
    const lookup: RawPIIMap = new Map();
    for (const [name, config] of Object.entries(this.config)) {
      const password = await resolveSource(name, "password", config.password, readFile);
      const username = config.username === undefined
        ? undefined
        : await resolveSource(name, "username", config.username, readFile);
      const forms = credentialForms(name, password, username);
      for (const form of forms) {
        const key = createPIIMapKey(form.type, form.id);
        if (lookup.has(key)) {
          throw new Error(`Credential "${name}" clashes with another credential's placeholder ${key}; rename one of them`);
        }
        lookup.set(key, form.value);
      }
      loaded.push({
        name,
        config,
        forms,
        ids: new Set(forms.map((form) => form.id)),
        tools: config.tools === undefined ? null : config.tools.map(toolPattern),
      });
    }
    this.loaded = loaded;
    this.lookup = lookup;
  }

  /** Every credential entry, for assigning the named IDs during tagging. */
  lookupEntries(): RawPIIMap {
    return this.lookup;
  }

  /** Finds echoed credential values, in any of their encoded forms. */
  recognizer(): Recognizer {
    return {
      type: PIIType.PASSWORD,
      name: "Configured Credential",
      defaultConfidence: 1.0,
      find: (text: string): SpanMatch[] => {
        const matches: SpanMatch[] = [];
        for (const credential of this.loaded) {
          for (const form of credential.forms) {
            if (form.value.length < MIN_MASKED_LENGTH) continue;
            let start = text.indexOf(form.value);
            while (start !== -1) {
              matches.push({
                type: form.type,
                start,
                end: start + form.value.length,
                confidence: 1.0,
                source: DetectionSource.REGEX,
                text: form.value,
              });
              start = text.indexOf(form.value, start + form.value.length);
            }
          }
        }
        return matches;
      },
    };
  }

  /**
   * Entries to add to the PII map when restoring one tool call's arguments:
   * those of every credential the arguments refer to and that may be used
   * with this tool and these hosts. Reports each decision through `onUse`.
   */
  entriesForToolCall(call: CredentialToolCall): RawPIIMap {
    const entries: RawPIIMap = new Map();
    const referenced = new Set<string>();
    const tags = extractTags(call.arguments, this.options.tagFormat ?? DEFAULT_TAG_FORMAT);
    for (const tag of tags) {
      if (tag.type === PIIType.USERNAME || tag.type === PIIType.PASSWORD) referenced.add(String(tag.id));
    }
    if (referenced.size === 0) return entries;

    let hosts: string[] | undefined;
    for (const credential of this.loaded) {
      if (![...credential.ids].some((id) => referenced.has(id))) continue;

      let reason: CredentialUseEvent["reason"];
      if (credential.tools !== null && !credential.tools.some((pattern) => pattern.test(call.name))) {
        reason = "tool-not-allowed";
      } else if (credential.config.hosts !== undefined) {
        // Placeholders inside a URL (https://user:<PII .../>@host) would stop
        // URL parsing, so blank them out first.
        hosts ??= targetHosts(withoutTags(call.arguments, tags));
        const allowed = credential.config.hosts;
        if (hosts.length === 0 || !hosts.every((host) => hostAllowed(host, allowed))) {
          reason = "host-not-allowed";
        }
      }

      this.options.onUse?.({
        credential: credential.name,
        tool: call.name,
        restored: reason === undefined,
        ...(reason === undefined ? {} : { reason }),
      });
      if (reason !== undefined) continue;
      for (const form of credential.forms) {
        entries.set(createPIIMapKey(form.type, form.id), form.value);
      }
    }
    return entries;
  }

  /** Names, descriptions and restrictions for the system instruction. No values. */
  describe(): CredentialDescription[] {
    return Object.entries(this.config).map(([name, config]) => ({
      name,
      ...(config.description === undefined ? {} : { description: config.description }),
      hasUsername: config.username !== undefined,
      ...(config.tools === undefined ? {} : { tools: config.tools }),
      ...(config.hosts === undefined ? {} : { hosts: config.hosts }),
    }));
  }

  /** The placeholder the model uses for a credential's username or password. */
  placeholder(type: PIIType.USERNAME | PIIType.PASSWORD, name: string): string {
    return generateTag(type, name, undefined, this.options.tagFormat ?? DEFAULT_TAG_FORMAT);
  }
}

/** Whether a PII map key belongs to a credential and must not be stored. */
export function isCredentialKey(key: string): boolean {
  return key.startsWith(`${PIIType.USERNAME}_`) || key.startsWith(`${PIIType.PASSWORD}_`);
}
