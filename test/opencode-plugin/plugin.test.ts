/**
 * Tests for the Rehydra OpenCode plugin.
 *
 * These tests invoke the plugin hooks directly with mock input/output objects,
 * verifying that:
 * - messages.transform anonymizes text parts and tool outputs
 * - system.transform injects the rehydra instruction
 * - tool.execute.before rehydrates PII tags in tool arguments
 * - text.complete rehydrates PII tags in LLM response text
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createRehydraPlugin } from "../../src/opencode-plugin/plugin.js";

// Helper: create a TextPart-like object
function textPart(
  text: string,
  sessionID = "ses-1",
  messageID = "msg-1",
): Record<string, unknown> {
  return {
    id: `part-${Math.random().toString(36).slice(2, 8)}`,
    sessionID,
    messageID,
    type: "text",
    text,
  };
}

// Helper: create a ToolPart-like object with completed state
function toolPart(
  output: string,
  sessionID = "ses-1",
  messageID = "msg-1",
): Record<string, unknown> {
  return {
    id: `part-${Math.random().toString(36).slice(2, 8)}`,
    sessionID,
    messageID,
    type: "tool",
    callID: `call-${Math.random().toString(36).slice(2, 8)}`,
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "echo test" },
      output,
      title: "bash",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  };
}

// Helper: create a non-text part (e.g., FilePart)
function filePart(
  sessionID = "ses-1",
  messageID = "msg-1",
): Record<string, unknown> {
  return {
    id: `part-${Math.random().toString(36).slice(2, 8)}`,
    sessionID,
    messageID,
    type: "file",
    path: "/some/file.ts",
  };
}

// Helper: create a message
function message(
  role: string,
  parts: Record<string, unknown>[],
  sessionID = "ses-1",
): { info: { sessionID: string; role: string }; parts: Record<string, unknown>[] } {
  return {
    info: {
      sessionID,
      role,
    },
    parts: parts as Array<{
      type: string;
      text?: string;
      state?: { status: string; output?: string };
      [key: string]: unknown;
    }>,
  };
}

// Mock OpenCode plugin context
function mockCtx(): { client: { app: { log: () => Promise<void> } }; directory: string; worktree: string } {
  return {
    client: { app: { log: async () => {} } },
    directory: "/test",
    worktree: "/test",
  };
}

// A secret value long enough to trigger detection (>= 8 chars default)
const TEST_SECRET = "sk-proj-abc123xyz789testkey";

describe("OpenCode Plugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hooks: Record<string, (...args: any[]) => Promise<void>>;

  beforeAll(async () => {
    const plugin = createRehydraPlugin({
      redactValues: [TEST_SECRET],
    });

    // Invoke the plugin factory with a mock context
    const result = await plugin(mockCtx());

    hooks = result as Record<string, (...args: any[]) => Promise<void>>;
  });

  describe("hooks registration", () => {
    it("should return all five hooks", () => {
      expect(hooks["experimental.chat.messages.transform"]).toBeTypeOf(
        "function",
      );
      expect(hooks["experimental.chat.system.transform"]).toBeTypeOf(
        "function",
      );
      expect(hooks["tool.execute.before"]).toBeTypeOf("function");
      expect(hooks["tool.execute.after"]).toBeTypeOf("function");
      expect(hooks["experimental.text.complete"]).toBeTypeOf("function");
    });
  });

  describe("messages.transform", () => {
    it.each(["completed", "error", "running"])("scrubs restored tool arguments in %s history", async (status) => {
      const original = {
        command: `printf '%s' '${TEST_SECRET}'`,
        nested: [{ email: "ada@example.com", count: 2, enabled: true, empty: null }],
        "ada@example.com": "a property name",
      };
      const state = { status, input: original, error: `Failed for ada@example.com: ${TEST_SECRET}` };
      const output = { messages: [message("assistant", [{ type: "tool", state }])] };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      expect(state.input.command).not.toContain(TEST_SECRET);
      expect(state.input.nested[0]!.email).toContain("<PII");
      expect(state.error).not.toContain(TEST_SECRET);
      expect(state.error).not.toContain("ada@example.com");
      expect(state.input.nested[0]).toMatchObject({ count: 2, enabled: true, empty: null });
      expect(state.input["ada@example.com"]).toBe("a property name");
      expect(original.command).toContain(TEST_SECRET);
      expect(original.nested[0]!.email).toBe("ada@example.com");

      const once = structuredClone(state.input);
      await hooks["experimental.chat.messages.transform"]!({}, output);
      expect(state.input).toEqual(once);

      const execution = { args: structuredClone(state.input) };
      await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "ses-1", callID: "replay" }, execution);
      expect(execution.args).toEqual(original);
    });

    it("should anonymize secrets in TextPart", async () => {
      const output = {
        messages: [
          message("user", [
            textPart(`Use this API key: ${TEST_SECRET}`),
          ]),
        ],
      };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const text = (output.messages[0]!.parts[0] as { text: string }).text;
      expect(text).not.toContain(TEST_SECRET);
      expect(text).toContain("<PII");
      expect(text).toContain("/>");
    });

    it("should anonymize secrets in ToolPart completed output", async () => {
      const output = {
        messages: [
          message("assistant", [
            toolPart(`Config loaded: API_KEY=${TEST_SECRET}`),
          ]),
        ],
      };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const state = (output.messages[0]!.parts[0] as { state: { output: string } }).state;
      expect(state.output).not.toContain(TEST_SECRET);
      expect(state.output).toContain("<PII");
    });

    it("should skip non-text parts", async () => {
      const fp = filePart();
      const output = {
        messages: [message("user", [fp])],
      };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      // FilePart should be unchanged
      expect(output.messages[0]!.parts[0]).toBe(fp);
    });

    it("should skip tool parts that are not completed", async () => {
      const tp: Record<string, unknown> = {
        id: "part-1",
        sessionID: "ses-1",
        messageID: "msg-1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: {
          status: "running",
        },
      };

      const output = {
        messages: [
          message("user", [tp]),
        ],
      };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      // Should not throw or modify
      expect((tp.state as { status: string }).status).toBe("running");
    });

    it("should not modify text without secrets", async () => {
      const originalText = "Hello, how can I help you today?";
      const output = {
        messages: [
          message("user", [textPart(originalText)]),
        ],
      };

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const text = (output.messages[0]!.parts[0] as { text: string }).text;
      expect(text).toBe(originalText);
    });
  });

  describe("system.transform", () => {
    it("should inject rehydra instruction after anonymization", async () => {
      // First, trigger anonymization so hasAnonymized = true
      const msgOutput = {
        messages: [
          message("user", [
            textPart(`Key: ${TEST_SECRET}`),
          ]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      // Now check system transform
      const sysOutput = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!({}, sysOutput);

      expect(sysOutput.system).toHaveLength(2);
      expect(sysOutput.system[1]).toContain("<rehydra>");
      expect(sysOutput.system[1]).toContain("PII placeholders");
    });
  });

  describe("tool.execute.before", () => {
    it("should rehydrate PII tags in string args", async () => {
      // First, anonymize to build the PII map
      const msgOutput = {
        messages: [
          message("user", [textPart(`Use key ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      // Extract the PII tag from the anonymized text
      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      expect(tagMatch).not.toBeNull();
      const piiTag = tagMatch![0]!;

      // Simulate tool args containing the PII tag
      const output = {
        args: { command: `curl -H "Authorization: Bearer ${piiTag}"` },
      };

      await hooks["tool.execute.before"]!(
        { tool: "bash", sessionID: "ses-1", callID: "call-1" },
        output,
      );

      const command = (output.args as { command: string }).command;
      expect(command).toContain(TEST_SECRET);
      expect(command).not.toContain("<PII");
    });

    it("should rehydrate PII tags in nested object args", async () => {
      // Anonymize first
      const msgOutput = {
        messages: [
          message("user", [textPart(`Secret: ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      const piiTag = tagMatch![0]!;

      const output = {
        args: {
          config: {
            nested: {
              value: `token=${piiTag}`,
            },
            list: [`item-${piiTag}`],
          },
        },
      };

      await hooks["tool.execute.before"]!(
        { tool: "write", sessionID: "ses-1", callID: "call-2" },
        output,
      );

      const args = output.args as { config: { nested: { value: string }; list: string[] } };
      expect(args.config.nested.value).toContain(TEST_SECRET);
      expect(args.config.list[0]).toContain(TEST_SECRET);
    });

    it("should pass through args without PII tags", async () => {
      const output = {
        args: { command: "ls -la", path: "/home/user" },
      };

      await hooks["tool.execute.before"]!(
        { tool: "bash", sessionID: "ses-1", callID: "call-3" },
        output,
      );

      expect(output.args).toEqual({ command: "ls -la", path: "/home/user" });
    });
  });

  describe("tool.execute.after", () => {
    it("should rehydrate PII tags in tool title", async () => {
      // Anonymize first
      const msgOutput = {
        messages: [
          message("user", [textPart(`Use key ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      const piiTag = tagMatch![0]!;

      const output = {
        title: `$ zwrm secrets set KEY "${piiTag}"`,
        output: "Updated secret KEY (version 1)",
        metadata: {},
      };

      await hooks["tool.execute.after"]!(
        { tool: "bash", sessionID: "ses-1", callID: "call-10", args: {} },
        output,
      );

      expect(output.title).toContain(TEST_SECRET);
      expect(output.title).not.toContain("<PII");
    });

    it("should rehydrate PII tags in tool output", async () => {
      const msgOutput = {
        messages: [
          message("user", [textPart(`Key: ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      const piiTag = tagMatch![0]!;

      const output = {
        title: "$ cat .env",
        output: `API_KEY=${piiTag}\nDEBUG=true`,
        metadata: {},
      };

      await hooks["tool.execute.after"]!(
        { tool: "bash", sessionID: "ses-1", callID: "call-11", args: {} },
        output,
      );

      expect(output.output).toContain(TEST_SECRET);
      expect(output.output).not.toContain("<PII");
      // title had no PII tags, should be unchanged
      expect(output.title).toBe("$ cat .env");
    });

    it("should rehydrate PII tags in MCP CallToolResult shape", async () => {
      // Anonymize first
      const msgOutput = {
        messages: [
          message("user", [textPart(`Key: ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      const piiTag = tagMatch![0]!;

      // MCP tools pass raw CallToolResult — no title/output fields
      const output = {
        content: [
          { type: "text", text: `Search results for ${piiTag}: found 3 matches` },
        ],
        isError: false,
      };

      await hooks["tool.execute.after"]!(
        { tool: "tavily_search", sessionID: "ses-1", callID: "call-13", args: {} },
        output,
      );

      const text = (output.content[0] as { text: string }).text;
      expect(text).toContain(TEST_SECRET);
      expect(text).not.toContain("<PII");
    });

    it("should not throw on MCP output without PII tags", async () => {
      const output = {
        content: [
          { type: "text", text: "No sensitive data here" },
        ],
        isError: false,
      };

      await hooks["tool.execute.after"]!(
        { tool: "exa_search", sessionID: "ses-1", callID: "call-14", args: {} },
        output,
      );

      expect((output.content[0] as { text: string }).text).toBe("No sensitive data here");
    });

    it("should not modify output without PII tags", async () => {
      const output = {
        title: "$ ls -la",
        output: "total 0\ndrwxr-xr-x 2 user user 64 Jan 1 00:00 .",
        metadata: {},
      };

      await hooks["tool.execute.after"]!(
        { tool: "bash", sessionID: "ses-1", callID: "call-12", args: {} },
        output,
      );

      expect(output.title).toBe("$ ls -la");
      expect(output.output).toBe("total 0\ndrwxr-xr-x 2 user user 64 Jan 1 00:00 .");
    });
  });

  describe("text.complete", () => {
    it("should rehydrate PII tags in response text", async () => {
      // Anonymize first to build PII map
      const msgOutput = {
        messages: [
          message("user", [textPart(`API key: ${TEST_SECRET}`)]),
        ],
      };
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const anonymizedText = (msgOutput.messages[0]!.parts[0] as { text: string }).text;
      const tagMatch = anonymizedText.match(/<PII[^/]*\/>/);
      const piiTag = tagMatch![0]!;

      // Simulate LLM response containing the PII tag
      const output = { text: `I found the key: ${piiTag}` };

      await hooks["experimental.text.complete"]!(
        { sessionID: "ses-1", messageID: "msg-2", partID: "part-2" },
        output,
      );

      expect(output.text).toContain(TEST_SECRET);
      expect(output.text).not.toContain("<PII");
    });

    it("should not modify text without PII tags", async () => {
      const output = { text: "Here is some regular text without any tags." };

      await hooks["experimental.text.complete"]!(
        { sessionID: "ses-1", messageID: "msg-3", partID: "part-3" },
        output,
      );

      expect(output.text).toBe("Here is some regular text without any tags.");
    });
  });

  describe("session management", () => {
    it("should maintain separate sessions per sessionID", async () => {
      // Create a fresh plugin to avoid cross-contamination from earlier tests
      const freshPlugin = createRehydraPlugin({
        redactValues: [TEST_SECRET],
      });
      const freshHooks = (await freshPlugin(mockCtx())) as Record<string, (...args: any[]) => Promise<void>>;

      // Anonymize in session A
      const outputA = {
        messages: [
          message("user", [textPart(`Key: ${TEST_SECRET}`)], "ses-A"),
        ],
      };
      await freshHooks["experimental.chat.messages.transform"]!({}, outputA);

      const tagA = (outputA.messages[0]!.parts[0] as { text: string }).text.match(
        /<PII[^/]*\/>/,
      )![0]!;

      // Rehydrate in session A — should work
      const argsA = { args: { cmd: tagA } };
      await freshHooks["tool.execute.before"]!(
        { tool: "bash", sessionID: "ses-A", callID: "c1" },
        argsA,
      );
      expect((argsA.args as { cmd: string }).cmd).toContain(TEST_SECRET);

      // Rehydrate in session B — should fail (no PII map)
      const argsB = { args: { cmd: tagA } };
      await expect(
        freshHooks["tool.execute.before"]!(
          { tool: "bash", sessionID: "ses-B", callID: "c2" },
          argsB,
        ),
      ).rejects.toThrow(/No PII map found/);
    });
  });
});
