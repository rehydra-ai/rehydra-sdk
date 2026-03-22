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
import type { RehydraPluginOptions } from "./types.js";

const REHYDRA_INSTRUCTION = `<rehydra>
Some values in this conversation have been replaced with PII placeholders like <PII type="..." id="..."/>. These are real values that have been masked for privacy during transit. They will be automatically rehydrated (replaced with the original values) before any command is executed locally.
IMPORTANT: Treat these placeholders exactly like real values. Do NOT try to resolve, decode, remove, or work around them. Use them as-is in commands, code, and tool calls. The rehydration layer handles the rest.
</rehydra>`;

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
): Promise<unknown> {
  if (typeof value === "string") {
    if (value.includes("<PII")) {
      return session.rehydrate(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      (value as unknown[])[i] = await deepRehydrate(value[i], session);
    }
    return value as unknown;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = await deepRehydrate(obj[key], session);
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

    const anonymizer = createAnonymizer({
      ...anonymizerConfig,
      keyProvider,
      piiStorageProvider: piiStorage,
    });
    await anonymizer.initialize();

    log("info", "plugin initialized", {
      envFiles: options?.envFiles,
      redactValueCount: options?.redactValues?.length ?? 0,
    });

    const locale = options?.locale;
    const policy = options?.policy;

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

          for (const part of msg.parts) {
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
          output.system.push(REHYDRA_INSTRUCTION);
        }
      },

      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown },
      ): Promise<void> => {
        const session = getSession(input.sessionID);
        const before = JSON.stringify(output.args);
        output.args = await deepRehydrate(output.args, session);
        const after = JSON.stringify(output.args);

        if (before !== after) {
          log("info", `rehydrated PII tags in tool args`, {
            tool: input.tool,
            callID: input.callID,
          });
        }
      },

      "tool.execute.after": async (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: unknown;
        },
        output: { title: string; output: string; metadata: unknown },
      ): Promise<void> => {
        const session = getSession(input.sessionID);
        let rehydrated = false;

        if (output.title.includes("<PII")) {
          output.title = await session.rehydrate(output.title);
          rehydrated = true;
        }
        if (output.output.includes("<PII")) {
          output.output = await session.rehydrate(output.output);
          rehydrated = true;
        }

        if (rehydrated) {
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
        if (output.text.includes("<PII")) {
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

export default createRehydraPlugin;
