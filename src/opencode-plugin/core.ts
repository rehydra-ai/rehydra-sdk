/**
 * Setup shared by the OpenCode 1 and OpenCode 2 plugins: options, the
 * anonymizer and its policies, per-session PII maps, scrubbing, env file
 * reloading, and tool argument handling.
 */

import { createAnonymizer } from "../core/anonymizer.js";
import { AnonymizerSessionImpl } from "../storage/session-base.js";
import { InMemoryPIIStorageProvider } from "../storage/in-memory.js";
import { InMemoryKeyProvider } from "../crypto/index.js";
import { PIIType, createDefaultPolicy, SECRET_PII_TYPES, DEFAULT_TAG_FORMAT } from "../types/index.js";
import type { AnonymizationPolicy } from "../types/index.js";
import type { PIITypeName, RehydraPluginOptions } from "./types.js";
import { buildPIISystemInstruction } from "../proxy/system-instruction.js";
import { buildTagPrefix } from "../utils/regex.js";
import { githubUsernameRecognizer } from "./github-username.js";
import { protectIdentityTags } from "./identity-recognizer.js";
import { vcsCommandTypes } from "./vcs-command.js";
import { gitIdentityRecognizer } from "./git-identity.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Log = (level: LogLevel, message: string, extra?: Record<string, unknown>) => void;

const DEFAULT_ENV_REFRESH_INTERVAL = 2000;
const DEFAULT_REDACT_TOOLS = ["webfetch", "websearch"];

/**
 * Merges options passed by OpenCode (opencode.json) with factory options.
 * Factory options take precedence per key.
 */
export function mergeOptions(
  configOptions: unknown,
  factoryOptions?: RehydraPluginOptions,
): RehydraPluginOptions {
  return { ...(configOptions as RehydraPluginOptions | undefined), ...factoryOptions };
}

/**
 * Recursively rehydrate all string values containing PII tags.
 * See deepMapStrings for what `inPlace` does.
 */
export async function deepRehydrate(
  value: unknown,
  session: AnonymizerSessionImpl,
  tagPrefix: string,
  inPlace: boolean,
): Promise<unknown> {
  return deepMapStrings(value, (text) => text.includes(tagPrefix) ? session.rehydrate(text) : text, inPlace);
}

/**
 * Applies `map` to every string.
 *
 * In place, arrays and objects are mutated: OpenCode 1 runs tools with the
 * original args reference, so replacing the object wholesale has no effect.
 * Otherwise they are never written to, because OpenCode 2 deep-freezes tool
 * input and uses the value the hook assigns back. A container is copied only
 * when one of its strings changes; when nothing changes, the original value
 * is returned.
 */
async function deepMapStrings(
  value: unknown,
  map: (text: string) => string | Promise<string>,
  inPlace: boolean,
): Promise<unknown> {
  if (typeof value === "string") return map(value);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  let target = inPlace ? source : undefined;
  for (const key of Object.keys(source)) {
    const item = await deepMapStrings(source[key], map, inPlace);
    if (target === undefined && item !== source[key]) target = copyContainer(source);
    if (target !== undefined) target[key] = item;
  }
  return target ?? value;
}

/** Shallow, unfrozen copy of an array or object that keeps its prototype. */
function copyContainer(value: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(value)) return value.slice() as unknown as Record<string, unknown>;
  return Object.assign(Object.create(Object.getPrototypeOf(value) as object | null) as object, value) as Record<string, unknown>;
}

/** Converts a tool name pattern with `*` wildcards to an anchored regex. */
function toolPattern(pattern: string): RegExp {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`);
}

/** Scrubs the messages of one model request and logs what it found. */
export interface RequestScrub {
  /** Anonymizes a string. */
  text(sessionID: string, text: string, policy?: Partial<AnonymizationPolicy>): Promise<string>;
  /** Anonymizes every string in a value, returning a copy so the original stays intact. */
  copy(sessionID: string, value: unknown, policy?: Partial<AnonymizationPolicy>): Promise<unknown>;
  /** Logs the totals for the request. */
  finish(messageCount: number): void;
}

export interface RehydraCore {
  readonly tagPrefix: string;
  readonly rehydraInstruction: string;
  /** Whether any request so far had something scrubbed. */
  readonly hasAnonymized: boolean;
  startRequest(): RequestScrub;
  /** Policy for a tool's output, widened for Git and GitHub CLI commands when vcsIdentities is on. */
  outputPolicy(command: unknown): Partial<AnonymizationPolicy> | undefined;
  /** Reloads env file secrets when envRefreshInterval has passed since the last check. */
  refreshSecrets(): Promise<void>;
  /** Restores real values in tool arguments, or keeps them redacted for redactTools. */
  beforeTool(tool: string, sessionID: string, callID: string, args: unknown): Promise<unknown>;
  /** Restores real values in a tool result. */
  afterTool(tool: string, sessionID: string, callID: string, result: unknown): Promise<unknown>;
  rehydrateText(sessionID: string, text: string): Promise<string>;
  /** Drops all PII maps. */
  dispose(): void;
}

export async function createRehydraCore(
  options: RehydraPluginOptions,
  context: {
    directory: string;
    log: Log;
    info?: Record<string, unknown>;
    /** Edit tool args and results in place (OpenCode 1) instead of returning copies (OpenCode 2). */
    mutateToolValues?: boolean;
  },
): Promise<RehydraCore> {
  const { log } = context;
  const inPlace = context.mutateToolValues === true;
  const keyProvider = new InMemoryKeyProvider();
  const piiStorage = new InMemoryPIIStorageProvider();

  // Build anonymizer config from options, sharing key and storage providers
  const baseConfig = options.anonymizer ?? {
    secrets: {
      enabled: true,
      envFiles: options.envFiles ?? ["**/.env*"],
      redactValues: options.redactValues,
      minValueLength: options.minValueLength,
    },
  };

  const anonymizerConfig = {
    ...baseConfig,
    secrets: baseConfig.secrets === undefined ? undefined : {
      ...baseConfig.secrets,
      envBaseDirectory: baseConfig.secrets.envBaseDirectory ?? context.directory,
    },
  };

  const tagFormat = anonymizerConfig.tagFormat ?? options.tagFormat ?? DEFAULT_TAG_FORMAT;
  const tagPrefix = buildTagPrefix(tagFormat);
  const rehydraInstruction = `<rehydra>\n${buildPIISystemInstruction(tagFormat)}\n</rehydra>`;

  const anonymizer = createAnonymizer({
    ...anonymizerConfig,
    tagFormat,
    keyProvider,
    piiStorageProvider: piiStorage,
  });
  if (options.vcsIdentities === true) {
    anonymizer.getRegistry().register(protectIdentityTags(githubUsernameRecognizer, tagFormat));
    anonymizer.getRegistry().register(protectIdentityTags(gitIdentityRecognizer, tagFormat));
  }
  await anonymizer.initialize();

  // Build policy with disabled types (URL and IP_ADDRESS disabled by default)
  const disableTypes: PIITypeName[] =
    options.disableTypes ?? ["URL", "IP_ADDRESS"];
  let policy: Partial<AnonymizationPolicy> | undefined = options.policy;
  if (disableTypes.length > 0) {
    const base = createDefaultPolicy();
    const disableSet = new Set<string>(disableTypes);
    const regexEnabledTypes = new Set(base.regexEnabledTypes);
    const nerEnabledTypes = new Set(base.nerEnabledTypes);
    // createDefaultPolicy() excludes secret types (they're opt-in via
    // AnonymizerConfig.secrets).  Add them back so that passing this
    // partial policy to mergePolicyWithBase doesn't accidentally drop
    // the secret types the anonymizer added to its internal default.
    for (const secretType of SECRET_PII_TYPES) {
      regexEnabledTypes.add(secretType);
    }
    for (const t of disableSet) {
      const piiType = t as PIIType;
      regexEnabledTypes.delete(piiType);
      nerEnabledTypes.delete(piiType);
    }
    policy = {
      ...policy,
      regexEnabledTypes,
      nerEnabledTypes,
    };
  }

  const redactToolNames = options.redactTools ?? DEFAULT_REDACT_TOOLS;
  const redactTools = redactToolNames.map(toolPattern);
  const envRefreshInterval = options.envRefreshInterval ?? DEFAULT_ENV_REFRESH_INTERVAL;

  log("info", "plugin initialized", {
    envFiles: anonymizerConfig.secrets?.envFiles,
    redactValueCount: options.redactValues?.length ?? 0,
    disableTypes,
    redactTools: redactToolNames,
    ...context.info,
  });

  const locale = options.locale;
  const identityPolicy = (types: PIIType[]): Partial<AnonymizationPolicy> => {
    const defaults = createDefaultPolicy();
    const configPolicy = anonymizerConfig.defaultPolicy;
    const enabledTypes = new Set(policy?.enabledTypes ?? configPolicy?.enabledTypes ?? defaults.enabledTypes);
    const regexEnabledTypes = new Set(policy?.regexEnabledTypes ?? configPolicy?.regexEnabledTypes ?? defaults.regexEnabledTypes);
    if (anonymizerConfig.secrets?.enabled === true) {
      for (const type of SECRET_PII_TYPES) {
        if (!disableTypes.includes(type)) { enabledTypes.add(type); regexEnabledTypes.add(type); }
      }
    }
    for (const type of types) {
      if (!disableTypes.includes(type)) { enabledTypes.add(type); regexEnabledTypes.add(type); }
    }
    return { ...policy, enabledTypes, regexEnabledTypes, reuseIdsForRepeatedPII: true };
  };

  // One session per OpenCode session, keyed by sessionID
  const sessions = new Map<string, AnonymizerSessionImpl>();

  function getSession(sessionID: string): AnonymizerSessionImpl {
    let session = sessions.get(sessionID);
    if (session === undefined) {
      session = new AnonymizerSessionImpl(
        anonymizer,
        sessionID,
        piiStorage,
        keyProvider,
      );
      sessions.set(sessionID, session);
    }
    return session;
  }

  // Track whether any anonymization occurred (to conditionally inject instruction)
  let hasAnonymized = false;

  let lastRefresh = Date.now();
  let refreshing: Promise<void> | undefined;

  return {
    tagPrefix,
    rehydraInstruction,
    get hasAnonymized(): boolean {
      return hasAnonymized;
    },

    startRequest(): RequestScrub {
      let totalScrubbed = 0;
      const scrubbedByType: Record<string, number> = {};

      const text = async (
        sessionID: string,
        value: string,
        activePolicy?: Partial<AnonymizationPolicy>,
      ): Promise<string> => {
        const result = await getSession(sessionID).anonymize(value, locale, activePolicy ?? policy);
        if (result.stats.totalEntities > 0) {
          hasAnonymized = true;
          totalScrubbed += result.stats.totalEntities;
          for (const [type, count] of Object.entries(result.stats.countsByType)) {
            scrubbedByType[type] = (scrubbedByType[type] ?? 0) + count;
          }
        }
        return result.anonymizedText;
      };

      // OpenCode retains the rehydrated arguments after tool execution and
      // serializes them into later model requests. Copy and scrub values so
      // the execution arguments and JSON property names stay intact.
      const copy = async (
        sessionID: string,
        value: unknown,
        activePolicy?: Partial<AnonymizationPolicy>,
      ): Promise<unknown> => {
        if (typeof value === "string") return text(sessionID, value, activePolicy);
        if (Array.isArray(value)) {
          const result: unknown[] = [];
          for (const item of value) result.push(await copy(sessionID, item, activePolicy));
          return result;
        }
        if (value !== null && typeof value === "object") {
          const entries: Array<[string, unknown]> = [];
          for (const [key, item] of Object.entries(value)) {
            entries.push([key, await copy(sessionID, item, activePolicy)]);
          }
          return Object.fromEntries(entries);
        }
        return value;
      };

      return {
        text,
        copy,
        finish(messageCount: number): void {
          if (totalScrubbed > 0) {
            // Only include types that actually had hits
            const nonZero: Record<string, number> = {};
            for (const [type, count] of Object.entries(scrubbedByType)) {
              if (count > 0) nonZero[type] = count;
            }
            log("info", `scrubbed ${totalScrubbed} secret(s) from messages`, {
              scrubbed: nonZero,
              messageCount,
            });
          } else {
            log("debug", "no secrets found in messages", { messageCount });
          }
        },
      };
    },

    outputPolicy(command: unknown): Partial<AnonymizationPolicy> | undefined {
      if (options.vcsIdentities !== true || typeof command !== "string") return policy;
      const commands = vcsCommandTypes(command);
      const types: PIIType[] = [];
      if (commands.has("github")) types.push(PIIType.GITHUB_USERNAME);
      if (commands.has("git")) types.push(PIIType.PERSON);
      return types.length > 0 ? identityPolicy(types) : policy;
    },

    refreshSecrets(): Promise<void> {
      if (envRefreshInterval === false) return Promise.resolve();
      if (refreshing !== undefined) return refreshing;
      if (Date.now() - lastRefresh < envRefreshInterval) return Promise.resolve();
      refreshing = (async (): Promise<void> => {
        try {
          if (await anonymizer.reloadSecrets()) log("info", "reloaded secrets from env files");
        } catch (error) {
          log("warn", "failed to reload env files", { error: String(error) });
        } finally {
          lastRefresh = Date.now();
          refreshing = undefined;
        }
      })();
      return refreshing;
    },

    async beforeTool(tool: string, sessionID: string, callID: string, args: unknown): Promise<unknown> {
      const session = getSession(sessionID);
      const before = JSON.stringify(args);
      const redacted = redactTools.some((pattern) => pattern.test(tool));
      const result = redacted
        ? await deepMapStrings(
          args,
          async (text) => (await session.anonymize(text, locale, policy)).anonymizedText,
          inPlace,
        )
        : await deepRehydrate(args, session, tagPrefix, inPlace);

      if (redacted) {
        log("info", "kept tool args redacted", { tool, callID });
      } else if (JSON.stringify(result) !== before) {
        log("info", "rehydrated PII tags in tool args", { tool, callID });
      }
      return result;
    },

    async afterTool(tool: string, sessionID: string, callID: string, result: unknown): Promise<unknown> {
      const before = JSON.stringify(result);
      const rehydrated = await deepRehydrate(result, getSession(sessionID), tagPrefix, inPlace);
      if (JSON.stringify(rehydrated) !== before) {
        log("info", "rehydrated PII tags in tool result", { tool, callID });
      }
      return rehydrated;
    },

    async rehydrateText(sessionID: string, text: string): Promise<string> {
      return text.includes(tagPrefix) ? getSession(sessionID).rehydrate(text) : text;
    },

    dispose(): void {
      sessions.clear();
      piiStorage.clear();
    },
  };
}
