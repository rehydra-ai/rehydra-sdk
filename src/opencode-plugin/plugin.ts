/**
 * Rehydra OpenCode Plugin
 *
 * Uses OpenCode's native plugin hooks to anonymize secrets before they
 * reach the LLM and rehydrate PII tags before local tool execution.
 *
 * Hooks used:
 * - experimental.chat.messages.transform — anonymize all text parts
 * - experimental.chat.system.transform  — inject rehydra instruction
 * - tool.execute.before                 — rehydrate PII tags in tool args
 * - experimental.text.complete          — rehydrate PII tags in LLM response
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

/**
 * OpenCode Plugin types — matches signatures from @opencode-ai/plugin.
 * Declared here to avoid a hard runtime dependency.
 */
interface PluginInput {
  client: OpencodeClient;
  directory: string;
  worktree: string;
  [key: string]: unknown;
}

interface OpencodeClient {
  app: {
    log(input: {
      body: {
        service: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        extra?: Record<string, unknown>;
      };
    }): Promise<unknown>;
  };
  [key: string]: unknown;
}

type Plugin = (input: PluginInput) => Promise<Hooks>;

interface Hooks {
  [key: string]: unknown;
}

/**
 * Recursively rehydrate all string values containing PII tags.
 * Returns a new value (for strings/arrays) or the same object mutated in-place
 * (for plain objects). The in-place mutation is required because OpenCode's
 * tool.execute.before hook uses the original args reference for execution —
 * replacing the object wholesale has no effect.
 */
async function deepRehydrate(
  value: unknown,
  session: AnonymizerSessionImpl,
  tagPrefix: string,
): Promise<unknown> {
  if (typeof value === "string") {
    if (value.includes(tagPrefix)) {
      return session.rehydrate(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      (value as unknown[])[i] = await deepRehydrate(value[i], session, tagPrefix);
    }
    return value as unknown;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = await deepRehydrate(obj[key], session, tagPrefix);
    }
    return obj;
  }
  return value;
}

/**
 * Creates a Rehydra plugin for OpenCode.
 *
 * @example
 * ```typescript
 * // .opencode/plugins/rehydra.ts
 * import { createRehydraPlugin } from "@rehydra/opencode-plugin";
 * export default createRehydraPlugin({
 *   envFiles: [".env", ".env.local"],
 * });
 * ```
 *
 * @example
 * ```json
 * // opencode.json — when published as npm package
 * { "plugin": ["@rehydra/opencode-plugin"] }
 * ```
 */
export function createRehydraPlugin(options?: RehydraPluginOptions): Plugin {
  return async (ctx) => {
    const { client } = ctx;
    const SERVICE = "rehydra";

    function log(
      level: "debug" | "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ): void {
      void client.app.log({ body: { service: SERVICE, level, message, extra } });
    }

    const keyProvider = new InMemoryKeyProvider();
    const piiStorage = new InMemoryPIIStorageProvider();

    // Build anonymizer config from options, sharing key and storage providers
    const anonymizerConfig = options?.anonymizer ?? {
      secrets: {
        enabled: true,
        envFiles: options?.envFiles,
        redactValues: options?.redactValues,
        minValueLength: options?.minValueLength,
      },
    };

    const tagFormat = anonymizerConfig.tagFormat ?? options?.tagFormat ?? DEFAULT_TAG_FORMAT;
    const tagPrefix = buildTagPrefix(tagFormat);
    const rehydraInstruction = `<rehydra>\n${buildPIISystemInstruction(tagFormat)}\n</rehydra>`;

    const anonymizer = createAnonymizer({
      ...anonymizerConfig,
      tagFormat,
      keyProvider,
      piiStorageProvider: piiStorage,
    });
    await anonymizer.initialize();

    // Build policy with disabled types (URL and IP_ADDRESS disabled by default)
    const disableTypes: PIITypeName[] =
      options?.disableTypes ?? ["URL", "IP_ADDRESS"];
    let policy: Partial<AnonymizationPolicy> | undefined = options?.policy;
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

    log("info", "plugin initialized", {
      envFiles: options?.envFiles,
      redactValueCount: options?.redactValues?.length ?? 0,
      disableTypes,
    });

    const locale = options?.locale;

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

    return {
      "experimental.chat.messages.transform": async (
        _input: Record<string, unknown>,
        output: {
          messages: Array<{
            info: { sessionID: string; role: string };
            parts: Array<{
              type: string;
              text?: string;
              state?: { status: string; output?: string };
              [key: string]: unknown;
            }>;
          }>;
        },
      ): Promise<void> => {
        let totalScrubbed = 0;
        const scrubbedByType: Record<string, number> = {};

        for (const msg of output.messages) {
          const session = getSession(msg.info.sessionID);

          // OpenCode retains the rehydrated arguments after tool execution and
          // serializes them into later model requests. Copy and scrub values so
          // the execution arguments and JSON property names stay intact.
          const scrubToolInput = async (value: unknown): Promise<unknown> => {
            if (typeof value === "string") {
              const result = await session.anonymize(value, locale, policy);
              if (result.stats.totalEntities > 0) {
                hasAnonymized = true;
                totalScrubbed += result.stats.totalEntities;
                for (const [type, count] of Object.entries(result.stats.countsByType)) {
                  scrubbedByType[type] = (scrubbedByType[type] ?? 0) + count;
                }
              }
              return result.anonymizedText;
            }
            if (Array.isArray(value)) {
              const result: unknown[] = [];
              for (const item of value) result.push(await scrubToolInput(item));
              return result;
            }
            if (value !== null && typeof value === "object") {
              const entries: Array<[string, unknown]> = [];
              for (const [key, item] of Object.entries(value)) {
                entries.push([key, await scrubToolInput(item)]);
              }
              return Object.fromEntries(entries);
            }
            return value;
          };

          for (const part of msg.parts) {
            if (part.type === "tool" && part.state !== undefined) {
              const state = part.state as typeof part.state & { input?: unknown; error?: string };
              if (state.input !== undefined) state.input = await scrubToolInput(state.input);
              if (typeof state.error === "string") {
                state.error = await scrubToolInput(state.error) as string;
              }
            }

            // Anonymize .text on any part type (text, reasoning, file, patch, etc.)
            if (typeof part.text === "string") {
              const result = await session.anonymize(part.text, locale, policy);
              if (result.stats.totalEntities > 0) {
                hasAnonymized = true;
                totalScrubbed += result.stats.totalEntities;
                for (const [type, count] of Object.entries(
                  result.stats.countsByType,
                )) {
                  scrubbedByType[type] = (scrubbedByType[type] ?? 0) + count;
                }
              }
              part.text = result.anonymizedText;
            }

            // Anonymize tool output
            if (
              part.state !== undefined &&
              part.state.status === "completed" &&
              typeof part.state.output === "string"
            ) {
              const result = await session.anonymize(
                part.state.output,
                locale,
                policy,
              );
              if (result.stats.totalEntities > 0) {
                hasAnonymized = true;
                totalScrubbed += result.stats.totalEntities;
                for (const [type, count] of Object.entries(
                  result.stats.countsByType,
                )) {
                  scrubbedByType[type] = (scrubbedByType[type] ?? 0) + count;
                }
              }
              part.state.output = result.anonymizedText;
            }
          }
        }

        if (totalScrubbed > 0) {
          // Only include types that actually had hits
          const nonZero: Record<string, number> = {};
          for (const [type, count] of Object.entries(scrubbedByType)) {
            if (count > 0) nonZero[type] = count;
          }
          log("info", `scrubbed ${totalScrubbed} secret(s) from messages`, {
            scrubbed: nonZero,
            messageCount: output.messages.length,
          });
        } else {
          log("debug", "no secrets found in messages", {
            messageCount: output.messages.length,
          });
        }
      },

      "experimental.chat.system.transform": (
        _input: Record<string, unknown>,
        output: { system: string[] },
      ): void => {
        if (hasAnonymized) {
          log("debug", "injected rehydra instruction into system prompt");
          output.system.push(rehydraInstruction);
        }
      },

      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown },
      ): Promise<void> => {
        const session = getSession(input.sessionID);
        const before = JSON.stringify(output.args);
        output.args = await deepRehydrate(output.args, session, tagPrefix);
        const after = JSON.stringify(output.args);

        if (before !== after) {
          log("info", `rehydrated PII tags in tool args`, {
            tool: input.tool,
            callID: input.callID,
          });
        }
      },

      // Output shape varies by tool type: native tools pass
      // { title, output, metadata } while MCP tools pass the raw
      // CallToolResult ({ content: [{type,text}], … }).  Use deepRehydrate
      // so we handle any shape without hard-coding field names.
      "tool.execute.after": async (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: unknown;
        },
        output: Record<string, unknown>,
      ): Promise<void> => {
        const session = getSession(input.sessionID);
        const before = JSON.stringify(output);
        await deepRehydrate(output, session, tagPrefix);

        if (JSON.stringify(output) !== before) {
          log("info", "rehydrated PII tags in tool result", {
            tool: input.tool,
            callID: input.callID,
          });
        }
      },

      "experimental.text.complete": async (
        input: { sessionID: string; messageID: string; partID: string },
        output: { text: string },
      ): Promise<void> => {
        if (output.text.includes(tagPrefix)) {
          const session = getSession(input.sessionID);
          output.text = await session.rehydrate(output.text);
          log("debug", "rehydrated PII tags in LLM response text", {
            messageID: input.messageID,
          });
        }
      },
    };
  };
}

export default createRehydraPlugin();
