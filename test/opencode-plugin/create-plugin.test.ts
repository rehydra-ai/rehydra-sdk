import { describe, it, expect } from "vitest";
import { createRehydraPlugin, RehydraAnthropicPlugin, RehydraOpenAIPlugin } from "../../src/opencode-plugin/index.js";

describe("createRehydraPlugin", () => {
  it("should create a plugin function", () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    expect(typeof plugin).toBe("function");
  });

  it("should return hooks with auth when called", async () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const hooks = await plugin({ directory: "/tmp/test-project" });

    expect(hooks.auth).toBeDefined();
    expect(hooks.auth.provider).toBe("anthropic");
    expect(hooks.auth.methods).toHaveLength(1);
    expect(hooks.auth.methods[0]!.label).toContain("anthropic");
    expect(typeof hooks.auth.loader).toBe("function");
  });

  it("should return fetch from loader when auth is available", async () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const hooks = await plugin({ directory: "/tmp/test-project" });

    const result = await hooks.auth.loader(async () => ({ key: "test-key" }));
    expect(result.fetch).toBeDefined();
    expect(typeof result.fetch).toBe("function");
  });

  it("should return empty object from loader when no auth", async () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const hooks = await plugin({ directory: "/tmp/test-project" });

    const result = await hooks.auth.loader(async () => null);
    expect(result.fetch).toBeUndefined();
  });

  it("should support custom provider", async () => {
    const plugin = createRehydraPlugin({ provider: "openai" });
    const hooks = await plugin({ directory: "/tmp/test-project" });

    expect(hooks.auth.provider).toBe("openai");
  });
});

describe("pre-configured plugins", () => {
  it("RehydraAnthropicPlugin should be a function", () => {
    expect(typeof RehydraAnthropicPlugin).toBe("function");
  });

  it("RehydraOpenAIPlugin should be a function", () => {
    expect(typeof RehydraOpenAIPlugin).toBe("function");
  });

  it("RehydraAnthropicPlugin should create anthropic auth", async () => {
    const hooks = await RehydraAnthropicPlugin({ directory: "/tmp/test" });
    expect(hooks.auth.provider).toBe("anthropic");
  });

  it("RehydraOpenAIPlugin should create openai auth", async () => {
    const hooks = await RehydraOpenAIPlugin({ directory: "/tmp/test" });
    expect(hooks.auth.provider).toBe("openai");
  });
});
