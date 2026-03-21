import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveConfig } from "../../src/opencode-plugin/config.js";

describe("resolveConfig", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it("returns defaults when no options or config provided", () => {
    const config = resolveConfig(
      { provider: "openai" },
      "/nonexistent/path",
    );
    expect(config.provider).toBe("openai");
    expect(config.minValueLength).toBe(8);
    expect(config.logLevel).toBe(false);
    expect(config.logFile).toBeNull();
  });

  it("uses explicit log option", () => {
    const config = resolveConfig(
      { provider: "openai", log: { level: "normal", file: "my.log" } },
      "/tmp",
    );
    expect(config.logLevel).toBe("normal");
    expect(config.logFile).toBe("my.log");
  });

  it("uses debug log option", () => {
    const config = resolveConfig(
      { provider: "openai", log: { level: "debug", file: "debug.log" } },
      "/tmp",
    );
    expect(config.logLevel).toBe("debug");
    expect(config.logFile).toBe("debug.log");
  });

  it("treats log: false as no logging", () => {
    const config = resolveConfig(
      { provider: "openai", log: false },
      "/tmp",
    );
    expect(config.logLevel).toBe(false);
    expect(config.logFile).toBeNull();
  });

  it("deprecated logFile without log option is treated as debug", () => {
    const config = resolveConfig(
      { provider: "openai", logFile: "old-style.log" },
      "/tmp",
    );
    expect(config.logLevel).toBe("debug");
    expect(config.logFile).toBe("old-style.log");
  });

  it("log option takes precedence over deprecated logFile", () => {
    const config = resolveConfig(
      {
        provider: "openai",
        log: { level: "normal", file: "new.log" },
        logFile: "old.log",
      },
      "/tmp",
    );
    expect(config.logLevel).toBe("normal");
    expect(config.logFile).toBe("new.log");
  });

  it("picks up REHYDRA_LOG_LEVEL env var", () => {
    process.env["REHYDRA_LOG_LEVEL"] = "normal";
    const config = resolveConfig(
      { provider: "openai" },
      "/tmp",
    );
    expect(config.logLevel).toBe("normal");
    expect(config.logFile).toBe("rehydra.log"); // default file
  });

  it("picks up REHYDRA_LOG_FILE env var", () => {
    process.env["REHYDRA_LOG_LEVEL"] = "debug";
    process.env["REHYDRA_LOG_FILE"] = "custom.log";
    const config = resolveConfig(
      { provider: "openai" },
      "/tmp",
    );
    expect(config.logLevel).toBe("debug");
    expect(config.logFile).toBe("custom.log");
  });

  it("explicit options take precedence over env vars", () => {
    process.env["REHYDRA_LOG_LEVEL"] = "debug";
    const config = resolveConfig(
      { provider: "openai", log: { level: "normal", file: "opt.log" } },
      "/tmp",
    );
    expect(config.logLevel).toBe("normal");
    expect(config.logFile).toBe("opt.log");
  });

  it("picks up REHYDRA_ENV_FILES env var", () => {
    process.env["REHYDRA_ENV_FILES"] = ".env, .env.local";
    const config = resolveConfig(
      { provider: "openai" },
      "/tmp",
    );
    expect(config.envFiles).toEqual([".env", ".env.local"]);
  });

  it("explicit envFiles take precedence over env var", () => {
    process.env["REHYDRA_ENV_FILES"] = ".env.from-env";
    const config = resolveConfig(
      { provider: "openai", envFiles: [".env.explicit"] },
      "/tmp",
    );
    expect(config.envFiles).toEqual([".env.explicit"]);
  });

  it("uses explicit redactValues", () => {
    const config = resolveConfig(
      { provider: "openai", redactValues: ["secret1", "secret2"] },
      "/tmp",
    );
    expect(config.redactValues).toEqual(["secret1", "secret2"]);
  });

  it("uses explicit minValueLength", () => {
    const config = resolveConfig(
      { provider: "openai", minValueLength: 4 },
      "/tmp",
    );
    expect(config.minValueLength).toBe(4);
  });

  it("handles missing .rehydra.json gracefully", () => {
    // /nonexistent/path won't have .rehydra.json
    const config = resolveConfig(
      { provider: "openai" },
      "/nonexistent/path/that/does/not/exist",
    );
    expect(config.provider).toBe("openai");
  });
});
