/**
 * Tests for keeping tool arguments redacted for selected tools (issue #108).
 */

import { describe, expect, it } from "vitest";
import { createRehydraPlugin } from "../../src/opencode-plugin/plugin.js";
import { createRehydraPluginV2 } from "../../src/opencode-plugin/plugin-v2.js";
import type { RehydraPluginOptions } from "../../src/opencode-plugin/types.js";

const SECRET = "sk-proj-abc123xyz789testkey";
type Hook = (...args: unknown[]) => Promise<void>;

/** Sets up a V1 plugin and returns its hooks plus the tag for SECRET in session ses-1. */
async function v1(options: RehydraPluginOptions): Promise<{ hooks: Record<string, Hook>; tag: string }> {
  const hooks = (await createRehydraPlugin({ redactValues: [SECRET], envFiles: [], ...options })({
    directory: "/test", worktree: "/test",
    client: { app: { log: async () => {} } },
  })) as Record<string, Hook>;
  const part = { type: "text", text: `Key: ${SECRET}` };
  await hooks["experimental.chat.messages.transform"]!({}, {
    messages: [{ info: { sessionID: "ses-1", role: "user" }, parts: [part] }],
  });
  return { hooks, tag: part.text.match(/<PII[^/]*\/>/)![0] };
}

async function runTool(hooks: Record<string, Hook>, tool: string, args: unknown): Promise<unknown> {
  const output = { args };
  await hooks["tool.execute.before"]!({ tool, sessionID: "ses-1", callID: "call-1" }, output);
  return output.args;
}

describe("redactTools", () => {
  it("keeps placeholders in arguments of redacted tools", async () => {
    const { hooks, tag } = await v1({ redactTools: ["webfetch"] });

    expect(await runTool(hooks, "webfetch", { url: `https://example.com/?key=${tag}` }))
      .toEqual({ url: `https://example.com/?key=${tag}` });
    expect(await runTool(hooks, "bash", { command: `echo ${tag}` }))
      .toEqual({ command: `echo ${SECRET}` });
  });

  it("redacts real values in arguments of redacted tools in place", async () => {
    const { hooks } = await v1({ redactTools: ["webfetch"] });
    const args = { url: `https://example.com/?key=${SECRET}`, headers: [`From: ada@example.com`] };

    const result = await runTool(hooks, "webfetch", args);

    expect(result).toBe(args);
    expect(JSON.stringify(args)).not.toContain(SECRET);
    expect(JSON.stringify(args)).not.toContain("ada@example.com");
    expect(args.url).toMatch(/^https:\/\/example\.com\/\?key=<PII type="[A-Z_]+" id="\d+"\/>$/);
  });

  it("matches tool names with * wildcards", async () => {
    const { hooks, tag } = await v1({ redactTools: ["exa_*"] });

    expect(await runTool(hooks, "exa_search", tag)).toBe(tag);
    expect(await runTool(hooks, "exa", tag)).toBe(SECRET);
    expect(await runTool(hooks, "my_exa_search", tag)).toBe(SECRET);
  });

  it("keeps webfetch, websearch, and image generation arguments redacted by default", async () => {
    const { hooks, tag } = await v1({});

    expect(await runTool(hooks, "webfetch", tag)).toBe(tag);
    expect(await runTool(hooks, "websearch", tag)).toBe(tag);
    expect(await runTool(hooks, "experimental_image_generate", tag)).toBe(tag);
    expect(await runTool(hooks, "image_generate", tag)).toBe(tag);
    expect(await runTool(hooks, "bash", tag)).toBe(SECRET);
  });

  it("restores every tool's arguments with an empty list", async () => {
    const { hooks, tag } = await v1({ redactTools: [] });
    expect(await runTool(hooks, "webfetch", tag)).toBe(SECRET);
  });

  it("keeps placeholders for redacted tools on OpenCode 2", async () => {
    const hooks = new Map<string, (event: unknown) => void | Promise<void>>();
    const register = (prefix: string) =>
      async (name: string, callback: (event: unknown) => void | Promise<void>): Promise<unknown> => {
        hooks.set(prefix + name, callback);
        return { dispose: async (): Promise<void> => {} };
      };
    await createRehydraPluginV2({ redactValues: [SECRET], envFiles: [] }).setup({
      app: { name: "opencode", version: "2.0.30" },
      location: { directory: "/test" },
      options: { redactTools: ["webfetch"] },
      session: { hook: register("session.") },
      tool: { hook: register("tool.") },
    });
    const part = { type: "text", text: `Key: ${SECRET}` };
    await hooks.get("session.context")!({
      sessionID: "ses-1", system: [], messages: [{ role: "user", content: [part] }],
    });
    const tag = part.text.match(/<PII[^/]*\/>/)![0];

    const fetch = { tool: "webfetch", sessionID: "ses-1", id: "call-1", input: { url: tag } };
    const bash = { tool: "bash", sessionID: "ses-1", id: "call-2", input: { command: tag } };
    await hooks.get("tool.execute.before")!(fetch);
    await hooks.get("tool.execute.before")!(bash);

    expect(fetch.input.url).toBe(tag);
    expect(bash.input.command).toBe(SECRET);
  });

  // OpenCode 2's image tool sends its prompt to an image model outside the
  // session hooks, so the tool hook is the only place to keep it redacted.
  it("keeps the image generation prompt redacted on OpenCode 2 by default", async () => {
    const hooks = new Map<string, (event: unknown) => void | Promise<void>>();
    const register = (prefix: string) =>
      async (name: string, callback: (event: unknown) => void | Promise<void>): Promise<unknown> => {
        hooks.set(prefix + name, callback);
        return { dispose: async (): Promise<void> => {} };
      };
    await createRehydraPluginV2({ redactValues: [SECRET], envFiles: [] }).setup({
      app: { name: "opencode", version: "2.2.5" },
      location: { directory: "/test" },
      options: {},
      session: { hook: register("session.") },
      tool: { hook: register("tool.") },
    });
    const part = { type: "text", text: `Key: ${SECRET}` };
    await hooks.get("session.context")!({
      sessionID: "ses-1", system: [], messages: [{ role: "user", content: [part] }],
    });
    const tag = part.text.match(/<PII[^/]*\/>/)![0];

    const image = {
      tool: "experimental_image_generate",
      sessionID: "ses-1",
      id: "call-1",
      input: { prompt: `A poster that reads ${tag}, signed ${SECRET}`, path: "poster.png" },
    };
    await hooks.get("tool.execute.before")!(image);

    expect(image.input.prompt).not.toContain(SECRET);
    expect(image.input.prompt).toMatch(/^A poster that reads <PII[^/]*\/>, signed <PII[^/]*\/>$/);
    expect(image.input.path).toBe("poster.png");
  });
});
