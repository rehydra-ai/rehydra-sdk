/**
 * Rehydra OpenCode Plugin — OpenCode 2 (V2 plugin API) implementation.
 *
 * OpenCode 2 replaces the V1 hooks-object entrypoint with a plugin definition
 * that exposes a stable `id` and registers hooks through a plugin context.
 * Mapping from the V1 hooks:
 *
 *   V1 hook                                V2 registration
 *   -------------------------------------- -----------------------------------------------------
 *   experimental.chat.messages.transform   ctx.session.hook("context" | "compaction" | "generate" | "title")
 *   experimental.chat.system.transform     same hooks — event.system.push({ type: "text", text })
 *   tool.execute.before                    ctx.tool.hook("execute.before") — assign a copy to event.input (input is frozen)
 *   tool.execute.after                     ctx.tool.hook("execute.after")  — event.result / event.status
 *   experimental.text.complete             no V2 equivalent (documented gap — see README)
 *   client.app.log                         console.* (captured by OpenCode's log service)
 *
 * The V2 session-request event shape (@opencode/ai SessionRequest) differs from
 * V1: { sessionID, system, messages: Message[] } where each Message has a role
 * and content parts. Text/reasoning parts carry `text`; tool-call parts carry
 * `input`; tool-result parts carry `result`. Tool calls and results share the
 * same `id` across messages, which is used to pair VCS commands with outputs.
 *
 * Registering the scrubber on all four session-request kinds also protects the
 * session-title request, closing the V1 title leak (OpenCode issue #46115)
 * without disabling the title agent.
 *
 * Structural types only: the plugin declares its own minimal shapes for the
 * OpenCode plugin context, so there is no runtime (or build) dependency on
 * OpenCode packages.
 */

/* eslint-disable no-console */

import type { RehydraPluginOptions } from "./types.js";
import { createRehydraCore, mergeOptions } from "./core.js";

/** Session request kinds that can be hooked in OpenCode 2. */
const REQUEST_KINDS: readonly ["context", "compaction", "generate", "title"] = [
  "context",
  "compaction",
  "generate",
  "title",
] as const;

/** Minimal structural shape of the parts the scrubber edits. */
interface ContentPartStub {
  type: string;
  text?: string | null;
  id?: string;
  input?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

/** Minimal structural shape of @opencode/ai Message. */
interface MessageStub {
  role: string;
  content?: unknown;
}

/** Minimal structural shape of @opencode/ai SessionRequest as delivered to hooks. */
interface SessionRequestEventStub {
  readonly sessionID: string;
  readonly system: Array<{ type: string; text: string }>;
  readonly messages: MessageStub[];
  [key: string]: unknown;
}

interface ToolExecuteBeforeEventStub {
  readonly tool: string;
  readonly sessionID: string;
  readonly id: string;
  input: unknown;
}

interface ToolExecuteAfterEventStub {
  readonly tool: string;
  readonly sessionID: string;
  readonly id: string;
  readonly status: "completed" | "error";
  result?: unknown;
}

/**
 * The part of the OpenCode 2 plugin context this plugin uses. The real context
 * (@opencode/plugin Context) satisfies this structurally.
 */
export interface RehydraV2PluginContext {
  readonly app: { readonly name: string; readonly version: string };
  readonly location: { readonly directory: string; readonly project?: unknown };
  readonly options: Record<string, unknown>;
  readonly session: {
    hook(
      name: string,
      callback: (event: unknown) => void | Promise<void>,
    ): Promise<unknown>;
  };
  readonly tool: {
    hook(
      name: string,
      callback: (event: unknown) => void | Promise<void>,
    ): Promise<unknown>;
  };
}

export type RehydraCleanup = () => void | Promise<void>;

/** Default-exported plugin definition consumed by OpenCode 2. */
export interface RehydraV2Plugin {
  readonly id: string;
  readonly setup: (
    context: RehydraV2PluginContext,
  ) => Promise<RehydraCleanup | void>;
}

/**
 * Creates a Rehydra plugin definition for OpenCode 2.
 *
 * @example
 * ```json
 * // opencode.json — published npm package with default options
 * { "plugins": ["@rehydra/opencode"] }
 * ```
 *
 * @example
 * ```json
 * // opencode.json — npm package with custom options
 * {
 *   "plugins": [{
 *     "package": "@rehydra/opencode",
 *     "options": { "envFiles": [".env", ".env.local"] }
 *   }]
 * }
 * ```
 *
 * @example
 * ```typescript
 * // .opencode/plugins/rehydra.ts — local plugin with custom options
 * import { createRehydraPluginV2 } from "@rehydra/opencode";
 * export default createRehydraPluginV2({
 *   envFiles: [".env", ".env.local"],
 * });
 * ```
 */
export function createRehydraPluginV2(
  options?: RehydraPluginOptions,
): RehydraV2Plugin {
  return {
    id: "rehydra",
    async setup(ctx): Promise<RehydraCleanup | void> {
      const SERVICE = "rehydra";

      // OpenCode 2 removes client.app.log from the plugin context. Plain console
      // output is captured by OpenCode's log service, so the structured
      // "service=rehydra …" entries survive in the log directory.
      function log(
        level: "debug" | "info" | "warn" | "error",
        message: string,
        extra?: Record<string, unknown>,
      ): void {
        const payload: Record<string, unknown> = {
          service: SERVICE,
          level,
          message,
          ...extra,
        };
        if (level === "error") {
          console.error(payload);
        } else if (level === "warn") {
          console.warn(payload);
        } else {
          console.log(payload);
        }
      }

      // Factory options take precedence over options from opencode.json
      // (ctx.options). Both feed the same RehydraPluginOptions shape.
      const core = await createRehydraCore(mergeOptions(ctx.options, options), {
        directory: ctx.location.directory,
        log,
        info: { opencode: `${ctx.app.name} ${ctx.app.version}` },
      });

      /**
       * Scrubs one outgoing model request. OpenCode 2 delivers the same request
       * shape to the `context` (agent loop), `compaction`, `generate`, and
       * `title` session hooks, so one implementation covers every kind.
       */
      async function scrubRequest(
        event: SessionRequestEventStub,
      ): Promise<void> {
        await core.refreshSecrets();
        const request = core.startRequest();

        // Commands by tool-call id, captured before scrubbing so VCS detection
        // tokens survive anonymization. Tool results pair with their call by id.
        const commandsByCallId = new Map<string, unknown>();

        for (const msg of event.messages) {
          const content = msg.content;
          if (!Array.isArray(content)) continue;

          for (const part of content as ContentPartStub[]) {
            if (part.type === "tool-call") {
              const input = part.input;
              if (typeof part.id === "string" && input !== null && typeof input === "object") {
                commandsByCallId.set(part.id, (input as { command?: unknown }).command);
              }
              part.input = await request.copy(event.sessionID, part.input);
            } else if (part.type === "text" || part.type === "reasoning") {
              if (typeof part.text === "string") {
                part.text = await request.text(event.sessionID, part.text);
              }
            } else if (
              part.type === "tool-result" &&
              part.result !== undefined &&
              part.result !== null
            ) {
              const command = typeof part.id === "string" ? commandsByCallId.get(part.id) : undefined;
              part.result = await request.copy(event.sessionID, part.result, core.outputPolicy(command));
            }
          }
        }

        request.finish(event.messages.length);

        if (core.hasAnonymized) {
          log("debug", "injected rehydra instruction into system prompt");
          event.system.push({ type: "text", text: core.rehydraInstruction });
        }
      }

      // Register the scrubber on every model-request kind OpenCode 2 can issue:
      // agent loop, checkpoint compaction, transient generates, session titles.
      for (const kind of REQUEST_KINDS) {
        await ctx.session.hook(kind, (event) =>
          scrubRequest(event as SessionRequestEventStub),
        );
      }

      await ctx.tool.hook("execute.before", async (event) => {
        const toolEvent = event as ToolExecuteBeforeEventStub;
        toolEvent.input = await core.beforeTool(
          toolEvent.tool,
          toolEvent.sessionID,
          toolEvent.id,
          toolEvent.input,
        );
      });

      // Result shape varies by tool type: native tools return their result
      // object while MCP tools return the raw CallToolResult
      // ({ content: [{type,text}], … }). Every string is rehydrated.
      await ctx.tool.hook("execute.after", async (event) => {
        const toolEvent = event as ToolExecuteAfterEventStub;
        if (toolEvent.status === "error") return;
        toolEvent.result = await core.afterTool(
          toolEvent.tool,
          toolEvent.sessionID,
          toolEvent.id,
          toolEvent.result,
        );
      });

      // Drop the PII maps when the plugin unloads.
      return () => core.dispose();
    },
  };
}

export default createRehydraPluginV2();
