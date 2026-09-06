import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRehydraPlugin } from "../../src/opencode-plugin/plugin.js";
import { NodeStorageProvider } from "../../src/utils/storage-node.js";
import { createAnonymizer } from "../../src/index.js";
import type { RehydraPluginOptions } from "../../src/opencode-plugin/types.js";

let directory: string;
async function fixture(path: string, value: string): Promise<void> {
  const full = join(directory, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `TOKEN=${value}\n`);
}
async function scrub(text: string, options?: RehydraPluginOptions): Promise<string> {
  const hooks = await createRehydraPlugin(options)({
    directory, worktree: directory,
    client: { app: { log: async () => {} } },
  });
  const output = { messages: [{ info: { sessionID: "env-test", role: "user" },
    parts: [{ type: "text", text, sessionID: "env-test", messageID: "msg-1" }],
  }] };
  await hooks["experimental.chat.messages.transform"]!({}, output);
  return output.messages[0]!.parts[0]!.text;
}

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "rehydra-env-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("project env file discovery", () => {
  it("loads root and nested env values with zero config, independently of cwd", async () => {
    await fixture(".env", "root-secret-value");
    await fixture("packages/api/.env.local", "nested-secret-value");
    const result = await scrub("root-secret-value nested-secret-value");
    expect(result).not.toContain("root-secret-value");
    expect(result).not.toContain("nested-secret-value");
    expect(result.match(/ENV_VAR_SECRET/g)).toHaveLength(2);
  });

  it("does not scan dependencies, git metadata, or symlinked directories", async () => {
    await fixture("node_modules/pkg/.env", "dependency-secret-value");
    await fixture("packages/api/node_modules/pkg/.env", "nested-dependency-secret");
    await fixture(".git/.env", "git-secret-value");
    await fixture("outside/secrets", "linked-secret-value");
    await symlink(join(directory, "outside"), join(directory, "linked"), "dir");
    await symlink(join(directory, "outside/secrets"), join(directory, ".env.link"));
    const text = "dependency-secret-value nested-dependency-secret git-secret-value linked-secret-value";
    expect(await scrub(text)).toBe(text);
  });

  it("allows opting out with an empty array", async () => {
    await fixture(".env", "root-secret-value");
    expect(await scrub("root-secret-value", { envFiles: [] })).toBe("root-secret-value");
  });

  it("honors exact paths without adding defaults", async () => {
    await fixture(".env", "root-secret-value");
    await fixture("app/custom.env", "custom-secret-value");
    const result = await scrub("root-secret-value custom-secret-value", { envFiles: ["app/custom.env"] });
    expect(result).toContain("root-secret-value");
    expect(result).not.toContain("custom-secret-value");
  });

  it("supports braces, exclusions, duplicate matches, and literal metacharacters", async () => {
    await fixture("app/.env.local", "included-secret-value");
    await fixture("app/.env.test", "excluded-secret-value");
    await fixture("[app]/.env", "bracket-secret-value");
    const storage = new NodeStorageProvider();
    expect(await storage.resolveFiles(["app/.env.{local,test}", "!app/.env.test", "app/.env.local", "[app]/.env"], directory))
      .toEqual([join(directory, "[app]/.env"), join(directory, "app/.env.local")].sort());
  });

  it("accepts absolute paths and tolerates missing files and no matches", async () => {
    await fixture(".env", "absolute-secret-value");
    const result = await scrub("absolute-secret-value", { envFiles: [join(directory, ".env"), "missing", "nothing/*.env"] });
    expect(result).not.toContain("absolute-secret-value");
  });

  it("preserves an advanced config opt-out", async () => {
    await fixture(".env", "root-secret-value");
    expect(await scrub("root-secret-value", { anonymizer: { secrets: { enabled: false } } })).toBe("root-secret-value");
  });

  it("roots advanced config paths at the project directory", async () => {
    await fixture(".env", "advanced-secret-value");
    expect(await scrub("advanced-secret-value", { anonymizer: { secrets: { enabled: true, envFiles: [".env"] } } }))
      .not.toContain("advanced-secret-value");
  });

  it("lets advanced consumers override the scan root", async () => {
    await fixture("nested/.env", "override-secret-value");
    expect(await scrub("override-secret-value", { anonymizer: { secrets: {
      enabled: true, envFiles: [".env"], envBaseDirectory: join(directory, "nested"),
    } } })).not.toContain("override-secret-value");
  });

  it("expands envFiles globs for standalone SDK consumers too", async () => {
    await fixture("nested/.env.local", "sdk-secret-value");
    const anonymizer = createAnonymizer({ secrets: { enabled: true, envFiles: ["**/.env*"], envBaseDirectory: directory } });
    try {
      await anonymizer.initialize();
      expect((await anonymizer.anonymize("sdk-secret-value")).anonymizedText).not.toContain("sdk-secret-value");
    } finally { await anonymizer.dispose(); }
  });
});
