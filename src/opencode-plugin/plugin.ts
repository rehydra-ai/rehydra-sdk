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

import type { RehydraPluginOptions } from "./types.js";
import { createRehydraCore, mergeOptions } from "./core.js";

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

type Plugin = (input: PluginInput, options?: Record<string, unknown>) => Promise<Hooks>;

interface Hooks {
  [key: string]: unknown;
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
 * { "plugin": [["@rehydra/opencode", { "disableTypes": ["DATE"] }]] }
 * ```
 */
export function createRehydraPlugin(factoryOptions?: RehydraPluginOptions): Plugin {
  return async (ctx, configOptions) => {
    const { client } = ctx;
    const SERVICE = "rehydra";

    function log(
      level: "debug" | "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ): void {
      void client.app.log({ body: { service: SERVICE, level, message, extra } });
    }

    // OpenCode passes options from opencode.json as the second argument.
    const core = await createRehydraCore(mergeOptions(configOptions, factoryOptions), {
      directory: ctx.directory,
      log,
      // OpenCode 1 runs tools with the original args reference and ignores
      // tool.execute.after return values, so edits must happen in place.
      mutateToolValues: true,
    });

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
        await core.refreshSecrets();
        const request = core.startRequest();

        for (const msg of output.messages) {
          const sessionID = msg.info.sessionID;

          for (const part of msg.parts) {
            // Read the command before scrubbing so VCS detection sees it intact
            const command = (
              part.state as { input?: { command?: unknown } } | undefined
            )?.input?.command;

            if (part.type === "tool" && part.state !== undefined) {
              const state = part.state as typeof part.state & { input?: unknown; error?: string };
              if (state.input !== undefined) state.input = await request.copy(sessionID, state.input);
              if (typeof state.error === "string") {
                state.error = await request.text(sessionID, state.error);
              }
            }

            // Anonymize .text on any part type (text, reasoning, file, patch, etc.)
            if (typeof part.text === "string") {
              part.text = await request.text(sessionID, part.text);
            }

            // Anonymize tool output
            if (
              part.state !== undefined &&
              part.state.status === "completed" &&
              typeof part.state.output === "string"
            ) {
              part.state.output = await request.text(
                sessionID,
                part.state.output,
                core.outputPolicy(command),
              );
            }
          }
        }

        request.finish(output.messages.length);
      },

      "experimental.chat.system.transform": (
        _input: Record<string, unknown>,
        output: { system: string[] },
      ): void => {
        if (core.hasAnonymized) {
          log("debug", "injected rehydra instruction into system prompt");
          output.system.push(core.rehydraInstruction);
        }
      },

      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown },
      ): Promise<void> => {
        output.args = await core.beforeTool(input.tool, input.sessionID, input.callID, output.args);
      },

      // Output shape varies by tool type: native tools pass
      // { title, output, metadata } while MCP tools pass the raw
      // CallToolResult ({ content: [{type,text}], … }).  Rehydrate every
      // string so we handle any shape without hard-coding field names.
      "tool.execute.after": async (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: unknown;
        },
        output: Record<string, unknown>,
      ): Promise<void> => {
        await core.afterTool(input.tool, input.sessionID, input.callID, output);
      },

      "experimental.text.complete": async (
        input: { sessionID: string; messageID: string; partID: string },
        output: { text: string },
      ): Promise<void> => {
        if (output.text.includes(core.tagPrefix)) {
          output.text = await core.rehydrateText(input.sessionID, output.text);
          log("debug", "rehydrated PII tags in LLM response text", {
            messageID: input.messageID,
          });
        }
      },
    };
  };
}

export default createRehydraPlugin();
