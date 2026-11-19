import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredentialsFile } from "../../../src/cli/utils/credentials.js";
import { CLIError } from "../../../src/cli/utils/errors.js";

describe("loadCredentialsFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rehydra-cli-cred-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should resolve relative file paths against the JSON file's directory", async () => {
    mkdirSync(join(dir, "secrets"));
    writeFileSync(join(dir, "secrets", "pw"), "s3cret\n");
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ github: { username: "bot", password: { file: "secrets/pw" }, tools: ["Bash"] } }),
    );

    const credentials = await loadCredentialsFile(join(dir, "credentials.json"));

    expect(credentials).toEqual({
      github: { username: "bot", password: { file: join(dir, "secrets", "pw") }, tools: ["Bash"] },
    });
  });

  it("should fail at startup when an env var is missing", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ github: { password: { env: "REHYDRA_CLI_MISSING" } } }));

    const error = await loadCredentialsFile(join(dir, "c.json")).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CLIError);
    expect((error as Error).message).toContain("environment variable REHYDRA_CLI_MISSING");
  });

  it.each([
    ["an array", "[]"],
    ["invalid JSON", "{"],
    ["a non-object credential", '{"github": "pw"}'],
    ["an invalid name", '{"github-prod": {"password": "x"}}'],
  ])("should reject %s", async (_label, content) => {
    writeFileSync(join(dir, "c.json"), content);

    await expect(loadCredentialsFile(join(dir, "c.json"))).rejects.toBeInstanceOf(CLIError);
  });
});
