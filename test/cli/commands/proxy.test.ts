import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { ParsedOptions } from "../../../src/cli/main.js";

// --- Mocks (before imports) ---

const mockServer = {
  listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
  close: vi.fn((cb: (err?: Error) => void) => cb()),
  on: vi.fn(),
};

vi.mock("node:http", () => ({
  createServer: vi.fn(() => mockServer as unknown as Server),
}));

vi.mock("../../../src/proxy/index.js", () => ({
  createRehydraProxy: vi.fn(() => vi.fn()),
  incomingMessageToRequest: vi.fn(),
  writeResponse: vi.fn(),
}));

vi.mock("../../../src/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isModelDownloaded: vi.fn(),
    downloadModel: vi.fn(),
  };
});

// --- Imports (after mocks) ---

import { createServer } from "node:http";
import { proxyCommand } from "../../../src/cli/commands/proxy.js";
import { createRehydraProxy } from "../../../src/proxy/index.js";
import { isModelDownloaded, downloadModel } from "../../../src/index.js";

const mockCreateServer = vi.mocked(createServer);
const mockCreateRehydraProxy = vi.mocked(createRehydraProxy);
const mockIsModelDownloaded = vi.mocked(isModelDownloaded);
const mockDownloadModel = vi.mocked(downloadModel);

// --- Helpers ---

function makeOptions(overrides?: Partial<ParsedOptions>): ParsedOptions {
  return {
    format: "text",
    ner: "disabled",
    "pii-map": ".rehydra-pii-map.json",
    mode: "pseudonymize",
    secrets: false,
    verbose: false,
    quiet: true,
    ...overrides,
  };
}

/**
 * Start proxyCommand and immediately trigger shutdown.
 * Returns the exit code promise.
 */
function startAndShutdown(
  provider: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  const promise = proxyCommand(provider, options);
  // Trigger shutdown on next tick (after server.listen resolves)
  setImmediate(() => {
    process.emit("SIGINT");
  });
  return promise;
}

// --- Tests ---

describe("proxy command", () => {
  let stderrChunks: string[];
  let origStderrWrite: typeof process.stderr.write;
  let origEnv: string | undefined;

  beforeEach(() => {
    stderrChunks = [];
    origStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    origEnv = process.env["REHYDRA_KEY"];
    delete process.env["REHYDRA_KEY"];

    vi.clearAllMocks();
    mockIsModelDownloaded.mockResolvedValue(true);
    mockDownloadModel.mockResolvedValue("/path/to/model");
    mockCreateRehydraProxy.mockReturnValue(vi.fn() as ReturnType<typeof createRehydraProxy>);
    mockServer.listen.mockImplementation((_port: number, _host: string, cb: () => void) => cb());
    mockServer.close.mockImplementation((cb: (err?: Error) => void) => cb());
    mockServer.on.mockReturnValue(mockServer);
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    if (origEnv !== undefined) {
      process.env["REHYDRA_KEY"] = origEnv;
    } else {
      delete process.env["REHYDRA_KEY"];
    }
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  // --- Validation ---

  describe("validation", () => {
    it("should throw when no provider given", async () => {
      await expect(
        proxyCommand(undefined, makeOptions()),
      ).rejects.toThrow("Missing provider argument");
    });

    it("should throw for unknown provider", async () => {
      await expect(
        proxyCommand("gemini", makeOptions()),
      ).rejects.toThrow("Unknown provider: gemini");
    });

    it("should throw for invalid port", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ port: "abc" })),
      ).rejects.toThrow("Invalid port");
    });

    it("should throw for port 0", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ port: "0" })),
      ).rejects.toThrow("Invalid port");
    });

    it("should throw for port > 65535", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ port: "99999" })),
      ).rejects.toThrow("Invalid port");
    });

    it("should throw for invalid NER mode", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ ner: "turbo" })),
      ).rejects.toThrow("Invalid NER mode");
    });

    it("should throw for unknown PII type in --types", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ types: "FAKE_TYPE" })),
      ).rejects.toThrow("Unknown PII type");
    });

    it("should throw for empty --types", async () => {
      await expect(
        proxyCommand("claude", makeOptions({ types: "  " })),
      ).rejects.toThrow("--types must specify at least one PII type");
    });
  });

  // --- Provider resolution ---

  describe("provider resolution", () => {
    it("should resolve 'claude' to anthropic upstream", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          upstream: "https://api.anthropic.com",
          provider: "anthropic",
        }),
      );
    });

    it("should resolve 'anthropic' to anthropic upstream", async () => {
      const exitCode = await startAndShutdown("anthropic", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          upstream: "https://api.anthropic.com",
          provider: "anthropic",
        }),
      );
    });

    it("should resolve 'openai' to openai upstream", async () => {
      const exitCode = await startAndShutdown("openai", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          upstream: "https://api.openai.com",
          provider: "openai",
        }),
      );
    });

    it("should be case insensitive", async () => {
      const exitCode = await startAndShutdown("Claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "anthropic" }),
      );
    });

    it("should use custom upstream when provided", async () => {
      const exitCode = await startAndShutdown(
        "openai",
        makeOptions({ upstream: "https://custom.api.com" }),
      );
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({ upstream: "https://custom.api.com" }),
      );
    });
  });

  // --- Server lifecycle ---

  describe("server lifecycle", () => {
    it("should start server on default port 8787", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockServer.listen).toHaveBeenCalledWith(8787, "127.0.0.1", expect.any(Function));
    });

    it("should start server on custom port", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ port: "9090" }));
      expect(exitCode).toBe(0);
      expect(mockServer.listen).toHaveBeenCalledWith(9090, "127.0.0.1", expect.any(Function));
    });

    it("should close server on shutdown", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockServer.close).toHaveBeenCalled();
    });

    it("should return 0 on clean shutdown", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
    });

    it("should shut down on SIGTERM", async () => {
      const promise = proxyCommand("claude", makeOptions());
      setImmediate(() => {
        process.emit("SIGTERM");
      });
      const exitCode = await promise;
      expect(exitCode).toBe(0);
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  // --- Key management ---

  describe("key management", () => {
    it("should use REHYDRA_KEY env var when set", async () => {
      process.env["REHYDRA_KEY"] = "2lpP0UaT/GcxIOQecCQ3bEhCkbH7Sf6rBmjezCPvc40=";
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          keyProvider: expect.objectContaining({}),
        }),
      );
    });

    it("should use --key flag over env var", async () => {
      process.env["REHYDRA_KEY"] = "envkey";
      const exitCode = await startAndShutdown(
        "claude",
        makeOptions({ key: "2lpP0UaT/GcxIOQecCQ3bEhCkbH7Sf6rBmjezCPvc40=" }),
      );
      expect(exitCode).toBe(0);
      // No error means key was accepted
    });

    it("should auto-generate key when neither provided", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions());
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalled();
    });
  });

  // --- Banner output ---

  describe("banner output", () => {
    it("should show anthropic connection hints for claude provider", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false }));
      expect(exitCode).toBe(0);
      const output = stderrChunks.join("");
      expect(output).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8787");
      expect(output).toContain("requires --api-key");
      expect(output).toContain("Claude Code");
      expect(output).toContain("anthropic");
    });

    it("should show openai connection hints for openai provider", async () => {
      const exitCode = await startAndShutdown("openai", makeOptions({ quiet: false }));
      expect(exitCode).toBe(0);
      const output = stderrChunks.join("");
      expect(output).toContain("OPENAI_BASE_URL");
      expect(output).toContain("/v1");
      expect(output).toContain("OpenAI SDK");
    });

    it("should show NER disabled when --ner disabled", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false, ner: "disabled" }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toContain("disabled");
    });

    it("should show NER loading when NER enabled", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false, ner: "quantized" }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toContain("loading...");
    });

    it("should show secrets enabled when --secrets active", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false, secrets: true }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toContain("Secrets");
    });

    it("should show custom port in banner", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false, port: "9999" }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toContain("9999");
    });

    it("should suppress banner in quiet mode", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: true }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toBe("");
    });

    it("should show shutdown message when not quiet", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: false }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).toContain("Shutting down");
    });

    it("should suppress shutdown message in quiet mode", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ quiet: true }));
      expect(exitCode).toBe(0);
      expect(stderrChunks.join("")).not.toContain("Shutting down");
    });
  });

  // --- Policy configuration ---

  describe("policy configuration", () => {
    it("should pass custom types to proxy config", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ types: "EMAIL,PHONE" }));
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: expect.objectContaining({
            enabledTypes: expect.any(Set),
          }),
        }),
      );
    });

    it("should enable secrets in anonymizer config", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ secrets: true }));
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          anonymizer: expect.objectContaining({
            secrets: { enabled: true },
          }),
        }),
      );
    });

    it("should add secret types when --types and --secrets combined", async () => {
      const exitCode = await startAndShutdown(
        "claude",
        makeOptions({ types: "EMAIL", secrets: true }),
      );
      expect(exitCode).toBe(0);
      const config = mockCreateRehydraProxy.mock.calls[0]![0];
      expect(config.policy).toBeDefined();
      expect(config.anonymizer).toMatchObject({ secrets: { enabled: true } });
    });

    it("should pass locale to proxy config", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ locale: "de-DE" }));
      expect(exitCode).toBe(0);
      expect(mockCreateRehydraProxy).toHaveBeenCalledWith(
        expect.objectContaining({ locale: "de-DE" }),
      );
    });
  });

  // --- NER background loading ---

  describe("NER background loading", () => {
    it("should skip NER loading when ner is disabled", async () => {
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "disabled" }));
      expect(exitCode).toBe(0);
      expect(mockIsModelDownloaded).not.toHaveBeenCalled();
      // Only one proxy created (no NER swap)
      expect(mockCreateRehydraProxy).toHaveBeenCalledTimes(1);
    });

    it("should create NER proxy when model already cached", async () => {
      mockIsModelDownloaded.mockResolvedValue(true);
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized" }));
      expect(exitCode).toBe(0);
      // Wait for background task
      await new Promise((r) => setTimeout(r, 50));
      expect(mockIsModelDownloaded).toHaveBeenCalledWith("quantized");
      expect(mockDownloadModel).not.toHaveBeenCalled();
      // Two proxies: initial regex-only + NER swap
      expect(mockCreateRehydraProxy).toHaveBeenCalledTimes(2);
    });

    it("should download model when not cached", async () => {
      mockIsModelDownloaded.mockResolvedValue(false);
      mockDownloadModel.mockResolvedValue("/path/to/model");
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized", quiet: false }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockDownloadModel).toHaveBeenCalledWith("quantized", expect.any(Function));
      expect(stderrChunks.join("")).toContain("Downloading NER model");
    });

    it("should fall back to regex-only on NER failure", async () => {
      mockIsModelDownloaded.mockRejectedValue(new Error("model corrupt"));
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized", quiet: false }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      // Only one proxy (no swap happened)
      expect(mockCreateRehydraProxy).toHaveBeenCalledTimes(1);
    });

    it("should suppress NER messages in quiet mode", async () => {
      mockIsModelDownloaded.mockResolvedValue(false);
      mockDownloadModel.mockResolvedValue("/path/to/model");
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized", quiet: true }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(stderrChunks.join("")).toBe("");
    });

    it("should use standard model mode when ner is standard", async () => {
      mockIsModelDownloaded.mockResolvedValue(true);
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "standard" }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockIsModelDownloaded).toHaveBeenCalledWith("standard");
    });

    it("should create NER proxy with autoDownload false", async () => {
      mockIsModelDownloaded.mockResolvedValue(true);
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized" }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      // Second call should have NER config
      const secondCall = mockCreateRehydraProxy.mock.calls[1];
      expect(secondCall).toBeDefined();
      expect(secondCall![0]).toMatchObject({
        anonymizer: {
          ner: {
            mode: "quantized",
            autoDownload: false,
          },
        },
      });
    });

    it("should invoke download progress callback when not quiet", async () => {
      mockIsModelDownloaded.mockResolvedValue(false);
      mockDownloadModel.mockImplementation(async (_mode, onProgress) => {
        onProgress?.({
          file: "model.onnx",
          bytesDownloaded: 50,
          totalBytes: 100,
          percent: 50,
        });
        return "/path/to/model";
      });
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized", quiet: false }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockDownloadModel).toHaveBeenCalled();
    });

    it("should fall back gracefully when download fails", async () => {
      mockIsModelDownloaded.mockResolvedValue(false);
      mockDownloadModel.mockRejectedValue(new Error("network error"));
      const exitCode = await startAndShutdown("claude", makeOptions({ ner: "quantized", quiet: false }));
      expect(exitCode).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      // Only regex proxy, no NER swap
      expect(mockCreateRehydraProxy).toHaveBeenCalledTimes(1);
    });
  });
});
