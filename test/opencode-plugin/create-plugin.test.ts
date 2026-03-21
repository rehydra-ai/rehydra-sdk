import { describe, it, expect, afterEach } from "vitest";
import { createRehydraPlugin, RehydraAnthropicPlugin, RehydraOpenAIPlugin } from "../../src/opencode-plugin/index.js";

describe("createRehydraPlugin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore original fetch after each test
    globalThis.fetch = originalFetch;
  });

  it("should create a plugin function", () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    expect(typeof plugin).toBe("function");
  });

  it("should patch globalThis.fetch when called", async () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const before = globalThis.fetch;
    await plugin({ directory: "/tmp/test-project" });

    expect(globalThis.fetch).not.toBe(before);
  });

  it("should pass through non-POST requests to original fetch", async () => {
    const mockFetch = async () => new Response("ok");
    globalThis.fetch = mockFetch as typeof fetch;

    const plugin = createRehydraPlugin({ provider: "anthropic" });
    await plugin({ directory: "/tmp/test-project" });

    const response = await globalThis.fetch("https://example.com");
    expect(await response.text()).toBe("ok");
  });

  it("should return empty hooks object", async () => {
    const plugin = createRehydraPlugin({ provider: "anthropic" });
    const hooks = await plugin({ directory: "/tmp/test-project" });

    expect(hooks).toEqual({});
  });
});

describe("pre-configured plugins", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("RehydraAnthropicPlugin should be a function", () => {
    expect(typeof RehydraAnthropicPlugin).toBe("function");
  });

  it("RehydraOpenAIPlugin should be a function", () => {
    expect(typeof RehydraOpenAIPlugin).toBe("function");
  });

  it("RehydraAnthropicPlugin should patch fetch", async () => {
    const before = globalThis.fetch;
    await RehydraAnthropicPlugin({ directory: "/tmp/test" });
    expect(globalThis.fetch).not.toBe(before);
  });

  it("RehydraOpenAIPlugin should patch fetch", async () => {
    const before = globalThis.fetch;
    await RehydraOpenAIPlugin({ directory: "/tmp/test" });
    expect(globalThis.fetch).not.toBe(before);
  });
});
