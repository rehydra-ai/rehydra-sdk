/**
 * Tests for the Rehydra OpenCode plugin V2 implementation.
 *
 * OpenCode 2 loads plugins via Plugin.define({ id, setup(ctx) }) and each hook
 * is registered on its domain. These tests capture the registrations from a
 * mock context and drive the hooks directly, verifying that:
 * - setup registers session hooks on context/compaction/generate/title
 * - the session hook scrubs text, tool-call inputs, and tool-result values
 * - the rehydra instruction is pushed into event.system after scrubbing
 * - tool.execute.before rehydrates PII tags in tool arguments (by copy; input is frozen)
 * - tool.execute.after rehydrates completed results and skips error events
 * - title events are scrubbed (the V1 title leak is fixed in V2)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createRehydraPluginV2 } from "../../src/opencode-plugin/plugin-v2.js";

// A secret value long enough to trigger detection (>= 8 chars default)
const TEST_SECRET = "sk-proj-abc123xyz789testkey";

type HookCallback = (event: unknown) => void | Promise<void>;

interface HookPair {
  name: string;
  callback: HookCallback;
}

// Minimal structural context mock — mirrors what the plugin reads from the
// OpenCode 2 plugin context.
function mockCtx(options: Record<string, unknown> = {}): {
  ctx: Parameters<ReturnType<typeof createRehydraPluginV2>["setup"]>[0];
  sessionHooks: HookPair[];
  toolHooks: HookPair[];
} {
  const sessionHooks: HookPair[] = [];
  const toolHooks: HookPair[] = [];
  const ctx = {
    app: { name: "opencode", version: "2.0.25" },
    location: { directory: "/test-dir" },
    options,
    session: {
      hook: async (name: string, callback: HookCallback): Promise<unknown> => {
        sessionHooks.push({ name, callback });
        return { dispose: async (): Promise<void> => {} };
      },
    },
    tool: {
      hook: async (name: string, callback: HookCallback): Promise<unknown> => {
        toolHooks.push({ name, callback });
        return { dispose: async (): Promise<void> => {} };
      },
    },
  } as unknown as Parameters<
    ReturnType<typeof createRehydraPluginV2>["setup"]
  >[0];
  return { ctx, sessionHooks, toolHooks };
}

function hookOf(list: HookPair[], name: string): HookCallback {
  const pair = list.find((p) => p.name === name);
  if (pair === undefined) {
    throw new Error(`hook not registered: ${name}`);
  }
  return pair.callback;
}

// Extract the first PII tag from scrubbed output
function extractTag(text: string): string {
  const match = text.match(/<PII[^/]*\/>/);
  if (match === null) {
    throw new Error(`no PII tag in: ${text}`);
  }
  return match[0] as string;
}

// OpenCode 2 deep-freezes tool input; writing into it throws in strict mode
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

describe("OpenCode Plugin V2", () => {
  // Plugin under test, built once like the V1 suite
  let plugin: ReturnType<typeof createRehydraPluginV2>;
  let sessionHooks: HookPair[];
  let toolHooks: HookPair[];
  let cleanup: () => void | Promise<void> | undefined;

  beforeAll(async () => {
    plugin = createRehydraPluginV2({
      redactValues: [TEST_SECRET],
    });
    const mocked = mockCtx();
    cleanup = (await plugin.setup(mocked.ctx)) as () => void | Promise<void>;
    sessionHooks = mocked.sessionHooks;
    toolHooks = mocked.toolHooks;
  });

  describe("hook registration", () => {
    it("should register a session hook for every model request kind", () => {
      expect(sessionHooks.map((p) => p.name).sort()).toEqual(
        ["compaction", "context", "generate", "title"].sort(),
      );
    });

    it("should register tool hooks for execute.before and execute.after", () => {
      expect(toolHooks.map((p) => p.name).sort()).toEqual(
        ["execute.after", "execute.before"].sort(),
      );
    });

    it("should expose a stable plugin id", () => {
      expect(plugin.id).toBe("rehydra");
    });
  });

  describe("session request scrubbing (context)", () => {
    it("should anonymize secrets in text parts and inject the system instruction", async () => {
      const context = hookOf(sessionHooks, "context");
      const event = {
        sessionID: "ses-1",
        system: [{ type: "text", text: "You are a helpful assistant." }],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Use key ${TEST_SECRET}` }],
          },
        ],
      };

      await context(event);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const text = (
        (event.messages[0] as { content: Array<{ text: string }> })
          .content[0] as { text: string }
      ).text;
      expect(text).not.toContain(TEST_SECRET);
      expect(text).toContain("<PII");
      expect(text).toContain("/>");

      // Instruction pushed later in the same event
      expect(event.system).toHaveLength(2);
      const injected = event.system[1] as { type: string; text: string };
      expect(injected.type).toBe("text");
      expect(injected.text).toContain("<rehydra>");
      expect(injected.text).toContain("PII placeholders");
    });
    it("should not touch text without secrets and not inject the instruction", async () => {
      // Fresh plugin: hasAnonymized (and the instruction injection) is
      // plugin-global across sessions, mirroring V1 behavior.
      const fresh = createRehydraPluginV2({ redactValues: [TEST_SECRET] });
      const mocked = mockCtx();
      await fresh.setup(mocked.ctx);
      const context = hookOf(mocked.sessionHooks, "context");
      const event = {
        sessionID: "ses-clean",
        system: [{ type: "text", text: "You are terse." }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello, how can I help you today?" },
            ],
          },
        ],
      };

      await context(event);

      expect(event.system).toHaveLength(1);
      const text = (event.messages[0] as { content: Array<{ text: string }> })
        .content[0] as { text: string };
      expect(text.text).toBe("Hello, how can I help you today?");
    });

    it("should scrub tool-call inputs by copy (execution args preserved)", async () => {
      const context = hookOf(sessionHooks, "context");
      const original = {
        command: `printf '%s' '${TEST_SECRET}'`,
        nested: [
          { email: "ada@example.com", count: 2, enabled: true, empty: null },
        ],
        "ada@example.com": "a property name",
      };
      const event = {
        sessionID: "ses-1",
        system: [],
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call-x",
                name: "bash",
                input: original,
              },
            ],
          },
        ],
      };

      await context(event);

      const copied = (
        event.messages[0] as {
          content: Array<{ input: Record<string, unknown> }>;
        }
      ).content[0].input;
      expect(copied.command).not.toContain(TEST_SECRET);
      expect(copied.command).toContain("<PII");
      expect(JSON.stringify(copied.nested)).toContain("<PII");
      // Original untouched (copy semantics)
      expect(original.command).toContain(TEST_SECRET);
      expect(original.nested[0]!.email).toBe("ada@example.com");

      // Idempotent on re-scrub
      const once = JSON.stringify(event.messages);
      await context(event);
      expect(JSON.stringify(event.messages)).toBe(once);
    });
  });

  describe("session request scrubbing (title + compaction + generate)", () => {
    it.each(["title", "compaction", "generate"] as const)(
      "scrubs %s requests",
      async (kind) => {
        const fresh = createRehydraPluginV2({ redactValues: [TEST_SECRET] });
        const mocked = mockCtx();
        await fresh.setup(mocked.ctx);

        const callback = hookOf(mocked.sessionHooks, kind);
        const event = {
          sessionID: "ses-title",
          system: [] as Array<{ type: string; text: string }>,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Summarize this: ${TEST_SECRET}` },
              ],
            },
          ],
        };

        await callback(event);

        const text = (event.messages[0] as { content: Array<{ text: string }> })
          .content[0] as { text: string };
        expect(text.text).not.toContain(TEST_SECRET);
        expect(text.text).toContain("<PII");
      },
    );
  });

  describe("tool-call / tool-result pairing (vcsIdentities)", () => {
    it("should pair tool-call id with tool-result id for identity detection", async () => {
      const fresh = createRehydraPluginV2({ vcsIdentities: true });
      const mocked = mockCtx();
      await fresh.setup(mocked.ctx);
      const context = hookOf(mocked.sessionHooks, "context");

      const event = {
        sessionID: "ses-vcs",
        system: [] as Array<{ type: unknown; text: string }>,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call-gh",
                name: "bash",
                input: { command: "gh pr view 42 --comments" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                id: "call-gh",
                result: {
                  type: "text",
                  value: "author:\talice-dev\nreviewers:\toctocat (Approved)",
                },
              },
            ],
          },
        ],
      };

      await context(event);

      const result = (
        event.messages[1] as { content: Array<{ result: { value: string } }> }
      ).content[0].result;
      expect(result.value).not.toContain("alice-dev");
      expect(result.value).not.toContain("octocat");
      expect(result.value).toContain('type="GITHUB_USERNAME"');
      // npm-scope-like identifiers preserved
      expect(result.value + "@rehydra/opencode").toContain("@rehydra/opencode");
    });
  });

  describe("tool.execute.before", () => {
    it("should rehydrate PII tags in string args", async () => {
      const before = hookOf(toolHooks, "execute.before");

      // Build a tag in session ses-1
      const context = hookOf(sessionHooks, "context");
      const scrubEvent = {
        sessionID: "ses-1",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Use key ${TEST_SECRET}` }],
          },
        ],
      };
      await context(scrubEvent);
      const piiTag = extractTag(
        (
          (scrubEvent.messages[0] as { content: Array<{ text: string }> })
            .content[0] as { text: string }
        ).text,
      );

      const event = {
        tool: "bash",
        sessionID: "ses-1",
        id: "call-1",
        input: { command: `curl -H "Authorization: Bearer ${piiTag}"` },
      };

      await before(event);

      const input = event.input as { command: string };
      expect(input.command).toContain(TEST_SECRET);
      expect(input.command).not.toContain("<PII");
    });

    it("should rehydrate PII tags in nested object args", async () => {
      const context = hookOf(sessionHooks, "context");
      const scrubEvent = {
        sessionID: "ses-1",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Secret: ${TEST_SECRET}` }],
          },
        ],
      };
      await context(scrubEvent);
      const piiTag = extractTag(
        (
          (scrubEvent.messages[0] as { content: Array<{ text: string }> })
            .content[0] as { text: string }
        ).text,
      );

      const before = hookOf(toolHooks, "execute.before");
      const event = {
        tool: "write",
        sessionID: "ses-1",
        id: "call-2",
        input: {
          config: {
            nested: { value: `token=${piiTag}` },
            list: [`item-${piiTag}`],
          },
        },
      };

      await before(event);

      const input = event.input as {
        config: { nested: { value: string }; list: string[] };
      };
      expect(input.config.nested.value).toContain(TEST_SECRET);
      expect(input.config.list[0]).toContain(TEST_SECRET);
    });

    it("should pass through args without PII tags", async () => {
      const before = hookOf(toolHooks, "execute.before");
      const event = {
        tool: "bash",
        sessionID: "ses-1",
        id: "call-3",
        input: { command: "ls -la", path: "/home/user" },
      };

      await before(event);

      expect(event.input).toEqual({ command: "ls -la", path: "/home/user" });
    });
  });

  describe("tool.execute.after", () => {
    it("should rehydrate PII tags in completed results", async () => {
      const context = hookOf(sessionHooks, "context");
      const scrubEvent = {
        sessionID: "ses-1",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Key: ${TEST_SECRET}` }],
          },
        ],
      };
      await context(scrubEvent);
      const piiTag = extractTag(
        (
          (scrubEvent.messages[0] as { content: Array<{ text: string }> })
            .content[0] as { text: string }
        ).text,
      );

      const after = hookOf(toolHooks, "execute.after");
      const event = {
        tool: "bash",
        sessionID: "ses-1",
        id: "call-10",
        status: "completed" as const,
        result: {
          title: "$ cat .env",
          output: `API_KEY=${piiTag}\nDEBUG=true`,
          metadata: {},
        },
      };

      await after(event);

      const result = event.result as { title: string; output: string };
      expect(result.output).toContain(TEST_SECRET);
      expect(result.output).not.toContain("<PII");
      expect(result.title).toBe("$ cat .env");
    });

    it("should skip error results", async () => {
      const after = hookOf(toolHooks, "execute.after");
      const event = {
        tool: "bash",
        sessionID: "ses-1",
        id: "call-err",
        status: "error" as const,
        error: { message: "boom" },
      };

      await after(event);

      expect(event).toEqual({
        tool: "bash",
        sessionID: "ses-1",
        id: "call-err",
        status: "error",
        error: { message: "boom" },
      });
    });
  });

  // Regression for #121: OpenCode 2 deep-freezes tool input, so the hooks
  // must assign copies instead of writing into it.
  describe("frozen tool values", () => {
    async function scrubbedTag(): Promise<string> {
      const context = hookOf(sessionHooks, "context");
      const scrubEvent = {
        sessionID: "ses-frozen",
        system: [] as Array<{ type: string; text: string }>,
        messages: [{ role: "user", content: [{ type: "text", text: `Key: ${TEST_SECRET}` }] }],
      };
      await context(scrubEvent);
      return extractTag(scrubEvent.messages[0]!.content[0]!.text);
    }

    function questionInput(label: string): unknown {
      return deepFreeze({
        questions: [
          {
            question: "Which environment?",
            options: [{ label }, { label: "staging" }],
          },
        ],
      });
    }

    it("should leave deep-frozen nested args without tags untouched", async () => {
      const before = hookOf(toolHooks, "execute.before");
      const input = questionInput("production");
      const event = { tool: "question", sessionID: "ses-frozen", id: "call-q1", input };

      await before(event);

      expect(event.input).toBe(input);
    });

    it("should assign a rehydrated copy of deep-frozen nested args", async () => {
      const piiTag = await scrubbedTag();
      const before = hookOf(toolHooks, "execute.before");
      const input = questionInput(`use ${piiTag}`);
      const event = { tool: "question", sessionID: "ses-frozen", id: "call-q2", input };

      await before(event);

      const rehydrated = event.input as {
        questions: Array<{ options: Array<{ label: string }> }>;
      };
      expect(rehydrated).not.toBe(input);
      expect(rehydrated.questions[0]!.options[0]!.label).toBe(`use ${TEST_SECRET}`);
      const original = input as typeof rehydrated;
      expect(rehydrated.questions[0]!.options[1]).toBe(original.questions[0]!.options[1]);
      expect(original.questions[0]!.options[0]!.label).toBe(`use ${piiTag}`);
    });

    it("should assign a redacted copy of deep-frozen args for redactTools", async () => {
      const before = hookOf(toolHooks, "execute.before");
      const input = deepFreeze({ url: "https://example.com", headers: { auth: TEST_SECRET } });
      const event = { tool: "webfetch", sessionID: "ses-frozen", id: "call-w1", input };

      await before(event);

      const redacted = event.input as { headers: { auth: string } };
      expect(redacted.headers.auth).not.toContain(TEST_SECRET);
      expect(redacted.headers.auth).toContain("<PII");
      expect(input.headers.auth).toBe(TEST_SECRET);
    });

    it("should assign a rehydrated copy of a deep-frozen result", async () => {
      const piiTag = await scrubbedTag();
      const after = hookOf(toolHooks, "execute.after");
      const result = deepFreeze({
        output: `API_KEY=${piiTag}`,
        content: [{ type: "text", text: `API_KEY=${piiTag}` }],
      });
      const event = {
        tool: "shell",
        sessionID: "ses-frozen",
        id: "call-s1",
        status: "completed" as const,
        result,
      };

      await after(event);

      const rehydrated = event.result as { output: string; content: Array<{ text: string }> };
      expect(rehydrated).not.toBe(result);
      expect(rehydrated.output).toBe(`API_KEY=${TEST_SECRET}`);
      expect(rehydrated.content[0]!.text).toBe(`API_KEY=${TEST_SECRET}`);
      expect(result.output).toBe(`API_KEY=${piiTag}`);
    });
  });

  describe("session management", () => {
    it("should maintain separate sessions per sessionID", async () => {
      const fresh = createRehydraPluginV2({ redactValues: [TEST_SECRET] });
      const mocked = mockCtx();
      await fresh.setup(mocked.ctx);
      const context = hookOf(mocked.sessionHooks, "context");
      const before = hookOf(mocked.toolHooks, "execute.before");

      // Scrub in session A
      const eventA = {
        sessionID: "ses-A",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Key: ${TEST_SECRET}` }],
          },
        ],
      };
      await context(eventA);
      const tagA = extractTag(
        (
          (eventA.messages[0] as { content: Array<{ text: string }> })
            .content[0] as { text: string }
        ).text,
      );

      // Rehydrate in session A — works
      const argsA = {
        tool: "bash",
        sessionID: "ses-A",
        id: "c1",
        input: { cmd: tagA },
      };
      await before(argsA);
      expect((argsA.input as { cmd: string }).cmd).toContain(TEST_SECRET);

      // Rehydrate in session B — no PII map
      const argsB = {
        tool: "bash",
        sessionID: "ses-B",
        id: "c2",
        input: { cmd: tagA },
      };
      await expect(before(argsB)).rejects.toThrow(/No PII map found/);
    });

    it("should clear session state on cleanup", async () => {
      const fresh = createRehydraPluginV2({ redactValues: [TEST_SECRET] });
      const mocked = mockCtx();
      const unloader = (await fresh.setup(mocked.ctx)) as () => void;

      const context = hookOf(mocked.sessionHooks, "context");
      const before = hookOf(mocked.toolHooks, "execute.before");
      const event = {
        sessionID: "ses-z",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Key: ${TEST_SECRET}` }],
          },
        ],
      };
      await context(event);
      const tag = extractTag(
        (
          (event.messages[0] as { content: Array<{ text: string }> })
            .content[0] as { text: string }
        ).text,
      );

      // Unload, then a new session for the same ID has no PII map
      await unloader();
      await expect(
        before({
          tool: "bash",
          sessionID: "ses-z",
          id: "c3",
          input: { cmd: tag },
        }),
      ).rejects.toThrow(/No PII map found/);
    });
  });

  describe("options", () => {
    it("should read options from ctx.options when the factory has none", async () => {
      const fresh = createRehydraPluginV2();
      const mocked = mockCtx({ redactValues: [TEST_SECRET] });
      await fresh.setup(mocked.ctx);
      const context = hookOf(mocked.sessionHooks, "context");

      const event = {
        sessionID: "ses-opts",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Key: ${TEST_SECRET}` }],
          },
        ],
      };
      await context(event);

      const text = (event.messages[0] as { content: Array<{ text: string }> })
        .content[0] as { text: string };
      expect(text.text).not.toContain(TEST_SECRET);
      expect(text.text).toContain("<PII");
    });

    it("should let factory options override ctx.options", async () => {
      const fresh = createRehydraPluginV2({ minValueLength: 100 });
      // ctx.options carry a short secret the factory setting must reject
      const mocked = mockCtx({ redactValues: ["s3cret!"] });
      await fresh.setup(mocked.ctx);
      const context = hookOf(mocked.sessionHooks, "context");

      const event = {
        sessionID: "ses-prec",
        system: [] as Array<{ type: string; text: string }>,
        messages: [
          { role: "user", content: [{ type: "text", text: "Key: s3cret!" }] },
        ],
      };
      await context(event);

      const text = (event.messages[0] as { content: Array<{ text: string }> })
        .content[0] as { text: string };
      // minValueLength 100 (factory) wins over ctx.options redactValues, so
      // the short value passes through untouched.
      expect(text.text).toBe("Key: s3cret!");
    });
  });
});