import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryKeyProvider } from "../../src/crypto/pii-map-crypto.js";
import { createRehydraProxy } from "../../src/proxy/rehydra-proxy.js";
import type {
  PathOverlapWarning,
  RehydraProxyConfig,
} from "../../src/proxy/types.js";
import { InMemoryPIIStorageProvider } from "../../src/storage/in-memory.js";

const { mockRehydraFetch } = vi.hoisted(() => ({
  mockRehydraFetch: vi.fn<typeof globalThis.fetch>(),
}));

vi.mock("../../src/proxy/rehydra-fetch.js", () => ({
  createRehydraFetch: vi.fn(() => mockRehydraFetch),
}));

function makeConfig(
  overrides: Partial<RehydraProxyConfig> = {},
): RehydraProxyConfig {
  return {
    upstream: "https://api.openai.com",
    provider: "openai",
    keyProvider: new InMemoryKeyProvider(),
    piiStorageProvider: new InMemoryPIIStorageProvider(),
    ...overrides,
  };
}

describe("createRehydraProxy path overlap warning", () => {
  beforeEach(() => {
    mockRehydraFetch.mockReset();
    mockRehydraFetch.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("should warn for the duplicated /v1 path from issue #77", async () => {
    const warnings: PathOverlapWarning[] = [];
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://nano-gpt.com/api/v1",
        onPathOverlapWarning: (warning) => warnings.push(warning),
      }),
    );

    await proxy(
      new Request(
        "http://127.0.0.1:8788/v1/chat/completions?request_id=example",
      ),
    );

    expect(warnings).toEqual([
      {
        overlappingSegments: ["v1"],
      },
    ]);
    expect(mockRehydraFetch).toHaveBeenCalledWith(
      "https://nano-gpt.com/api/v1/v1/chat/completions?request_id=example",
      expect.any(Object),
    );
  });

  it("should report the longest overlap when multiple path segments match", async () => {
    const warnings: PathOverlapWarning[] = [];
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/proxy/api/v1",
        onPathOverlapWarning: (warning) => warnings.push(warning),
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/api/v1/chat/completions"),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.overlappingSegments).toEqual(["api", "v1"]);
  });

  it("should not warn when a shared segment does not overlap at the join boundary", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/api/v1",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/api/v2/chat/completions"),
    );

    expect(onPathOverlapWarning).not.toHaveBeenCalled();
  });

  it("should compare complete path segments instead of partial strings", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/v1",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/v10/chat/completions"),
    );

    expect(onPathOverlapWarning).not.toHaveBeenCalled();
  });

  it("should not warn when the upstream has no base path", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://api.openai.com",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/v1/chat/completions"),
    );

    expect(onPathOverlapWarning).not.toHaveBeenCalled();
  });

  it("should check the pathname after stripPrefix is applied", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/api",
        stripPrefix: "/api",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/api/v1/chat/completions"),
    );

    expect(onPathOverlapWarning).not.toHaveBeenCalled();
    expect(mockRehydraFetch).toHaveBeenCalledWith(
      "https://example.com/api/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("should skip overlap detection when the upstream is not an absolute URL", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "api.example.com/v1",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/v1/chat/completions"),
    );

    expect(onPathOverlapWarning).not.toHaveBeenCalled();
    expect(mockRehydraFetch).toHaveBeenCalledWith(
      "api.example.com/v1/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("should warn only once for repeated overlapping requests", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/v1",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/v1/chat/completions"),
    );
    await proxy(
      new Request("http://127.0.0.1:8788/v1/embeddings"),
    );

    expect(onPathOverlapWarning).toHaveBeenCalledTimes(1);
  });
});
