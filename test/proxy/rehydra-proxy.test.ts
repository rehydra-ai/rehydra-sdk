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
        upstream: "https://nano-gpt.com/api/v1/",
        onPathOverlapWarning: (warning) => {
          warnings.push(warning);
        },
      }),
    );

    await proxy(
      new Request(
        "http://127.0.0.1:8788/v1/chat/completions?request_id=example",
      ),
    );

    expect(warnings).toEqual([
      {
        upstreamBaseUrl: "https://nano-gpt.com/api/v1",
        overlappingSegments: ["v1"],
      },
    ]);
    const warningPayload = JSON.stringify(warnings[0]);
    expect(warningPayload).not.toContain("chat/completions");
    expect(warningPayload).not.toContain("request_id=example");
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
        onPathOverlapWarning: (warning) => {
          warnings.push(warning);
        },
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

  it("should warn for every overlapping request", async () => {
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

    expect(onPathOverlapWarning).toHaveBeenCalledTimes(2);
  });

  it("should report a wider overlap found on a later request", async () => {
    const onPathOverlapWarning = vi.fn();
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/api/v1",
        onPathOverlapWarning,
      }),
    );

    await proxy(
      new Request("http://127.0.0.1:8788/v1/chat/completions"),
    );
    await proxy(
      new Request("http://127.0.0.1:8788/api/v1/embeddings"),
    );

    expect(onPathOverlapWarning).toHaveBeenNthCalledWith(1, {
      upstreamBaseUrl: "https://example.com/api/v1",
      overlappingSegments: ["v1"],
    });
    expect(onPathOverlapWarning).toHaveBeenNthCalledWith(2, {
      upstreamBaseUrl: "https://example.com/api/v1",
      overlappingSegments: ["api", "v1"],
    });
  });

  it("should continue proxying when the warning callback throws", async () => {
    const proxy = createRehydraProxy(
      makeConfig({
        upstream: "https://example.com/v1",
        onPathOverlapWarning: () => {
          throw new Error("warning callback failed");
        },
      }),
    );

    const response = await proxy(
      new Request("http://127.0.0.1:8788/v1/chat/completions"),
    );

    expect(response.status).toBe(204);
    expect(mockRehydraFetch).toHaveBeenCalledWith(
      "https://example.com/v1/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("should continue proxying when an async warning callback rejects", async () => {
    let rejectWarningCallback: (reason: Error) => void = () => {};
    const warningCallbackResult = new Promise<void>((_resolve, reject) => {
      rejectWarningCallback = reject;
    });
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const proxy = createRehydraProxy(
        makeConfig({
          upstream: "https://example.com/v1",
          onPathOverlapWarning: () => warningCallbackResult,
        }),
      );

      const response = await proxy(
        new Request("http://127.0.0.1:8788/v1/chat/completions"),
      );

      expect(response.status).toBe(204);
      expect(mockRehydraFetch).toHaveBeenCalledWith(
        "https://example.com/v1/v1/chat/completions",
        expect.any(Object),
      );

      rejectWarningCallback(new Error("async warning callback failed"));
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  // The callback returns an already-rejected promise, so the rejection is only
  // handled if the proxy attaches its catch before the microtask checkpoint
  it("should continue proxying when an async warning callback throws", async () => {
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const proxy = createRehydraProxy(
        makeConfig({
          upstream: "https://example.com/v1",
          onPathOverlapWarning: async () => {
            throw new Error("async warning callback failed");
          },
        }),
      );

      const response = await proxy(
        new Request("http://127.0.0.1:8788/v1/chat/completions"),
      );

      expect(response.status).toBe(204);
      expect(mockRehydraFetch).toHaveBeenCalledWith(
        "https://example.com/v1/v1/chat/completions",
        expect.any(Object),
      );

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

});
