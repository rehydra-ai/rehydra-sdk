/**
 * Tests for the credential store in the OpenCode plugin (issue #135).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRehydraPlugin } from "../../src/opencode-plugin/plugin.js";
import type { RehydraPluginOptions } from "../../src/opencode-plugin/types.js";

const PASSWORD = "correct horse battery staple";
const TAG = '<PII type="PASSWORD" id="github"/>';
type Hook = (...args: unknown[]) => Promise<void> | void;

async function plugin(
  options: RehydraPluginOptions,
  directory = "/test",
): Promise<{ hooks: Record<string, Hook>; logs: Array<{ message: string; extra?: unknown }> }> {
  const logs: Array<{ message: string; extra?: unknown }> = [];
  const hooks = (await createRehydraPlugin({ envFiles: [], ...options })({
    directory,
    worktree: directory,
    client: {
      app: {
        log: async (entry: { body: { message: string; extra?: unknown } }) => {
          logs.push({ message: entry.body.message, extra: entry.body.extra });
        },
      },
    },
  })) as Record<string, Hook>;
  return { hooks, logs };
}

async function runTool(hooks: Record<string, Hook>, tool: string, args: unknown): Promise<unknown> {
  const output = { args };
  await hooks["tool.execute.before"]!({ tool, sessionID: "ses-1", callID: "call-1" }, output);
  return output.args;
}

describe("credentials in the OpenCode plugin", () => {
  it("should add the credential list to the system prompt from the first request", async () => {
    const { hooks } = await plugin({ credentials: { github: { password: PASSWORD, description: "GitHub bot" } } });
    const output = { system: [] as string[] };

    await hooks["experimental.chat.system.transform"]!({}, output);

    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain(`- github (GitHub bot): password ${TAG}.`);
    expect(output.system[0]).not.toContain(PASSWORD);
  });

  it("should fill in allowed tools, and keep placeholders for others and for redactTools", async () => {
    const { hooks, logs } = await plugin({
      credentials: { github: { password: PASSWORD, tools: ["bash", "webfetch"] } },
    });

    expect(await runTool(hooks, "bash", { command: `login '${TAG}'` })).toEqual({ command: `login '${PASSWORD}'` });
    expect(await runTool(hooks, "edit", { content: TAG })).toEqual({ content: TAG });
    // webfetch is allowed by the credential but is a default redactTool.
    expect(await runTool(hooks, "webfetch", { url: `https://x.example/?p=${TAG}` }))
      .toEqual({ url: `https://x.example/?p=${TAG}` });

    expect(logs.find((log) => log.message === "filled in credential for tool")?.extra)
      .toMatchObject({ credential: "github", tool: "bash" });
    expect(logs.find((log) => log.message === "kept credential placeholder in tool args")?.extra)
      .toMatchObject({ credential: "github", tool: "edit", reason: "tool-not-allowed" });
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
  });

  it("should mask the value when it comes back in tool output", async () => {
    const { hooks } = await plugin({ credentials: { github: { password: PASSWORD } } });
    const part = { type: "text", text: `config: password=${PASSWORD}` };

    await hooks["experimental.chat.messages.transform"]!({}, {
      messages: [{ info: { sessionID: "ses-1", role: "user" }, parts: [part] }],
    });

    expect(part.text).toBe(`config: password=${TAG}`);
  });

  it("should resolve relative file paths against the project directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rehydra-plugin-cred-"));
    try {
      mkdirSync(join(dir, "secrets"));
      writeFileSync(join(dir, "secrets", "github.txt"), `${PASSWORD}\n`);
      const { hooks } = await plugin({ credentials: { github: { password: { file: "secrets/github.txt" } } } }, dir);

      expect(await runTool(hooks, "bash", { command: TAG })).toEqual({ command: PASSWORD });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
