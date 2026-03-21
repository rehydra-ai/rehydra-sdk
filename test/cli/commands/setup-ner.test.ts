import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ParsedOptions } from "../../../src/cli/main.js";

// Mock the model manager before importing the command
vi.mock("../../../src/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    isModelDownloaded: vi.fn(),
    downloadModel: vi.fn(),
  };
});

import { setupNerCommand } from "../../../src/cli/commands/setup-ner.js";
import { isModelDownloaded, downloadModel } from "../../../src/index.js";

const mockIsModelDownloaded = vi.mocked(isModelDownloaded);
const mockDownloadModel = vi.mocked(downloadModel);

function makeOptions(overrides?: Partial<ParsedOptions>): ParsedOptions {
  return {
    format: "text",
    ner: "quantized",
    "pii-map": ".rehydra-pii-map.json",
    mode: "pseudonymize",
    verbose: false,
    quiet: true,
    ...overrides,
  };
}

describe("setup-ner command", () => {
  let stderrChunks: string[];
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrChunks = [];
    origStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
  });

  it("should return 0 when model is already downloaded", async () => {
    mockIsModelDownloaded.mockResolvedValue(true);
    const exitCode = await setupNerCommand(makeOptions());
    expect(exitCode).toBe(0);
    expect(mockDownloadModel).not.toHaveBeenCalled();
  });

  it("should print message when model already downloaded and not quiet", async () => {
    mockIsModelDownloaded.mockResolvedValue(true);
    await setupNerCommand(makeOptions({ quiet: false }));
    expect(stderrChunks.join("")).toContain("already downloaded");
  });

  it("should download model when not already present", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockResolvedValue("/path/to/model");
    const exitCode = await setupNerCommand(makeOptions());
    expect(exitCode).toBe(0);
    expect(mockDownloadModel).toHaveBeenCalledWith("quantized", expect.any(Function), undefined);
  });

  it("should download standard model when ner is standard", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockResolvedValue("/path/to/model");
    await setupNerCommand(makeOptions({ ner: "standard" }));
    expect(mockDownloadModel).toHaveBeenCalledWith("standard", expect.any(Function), undefined);
  });

  it("should print status messages when not quiet", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockResolvedValue("/path/to/model");
    await setupNerCommand(makeOptions({ quiet: false }));
    const output = stderrChunks.join("");
    expect(output).toContain("Downloading");
    expect(output).toContain("downloaded successfully");
  });

  it("should throw CLIError when download fails", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockRejectedValue(new Error("network error"));
    await expect(
      setupNerCommand(makeOptions()),
    ).rejects.toThrow("Failed to download NER model: network error");
  });

  it("should invoke onProgress callback when not quiet", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockImplementation(async (_mode, onProgress) => {
      // Simulate a progress callback
      onProgress?.({ file: "model.onnx", bytesDownloaded: 50, totalBytes: 100, percent: 50 });
      return "/path/to/model";
    });
    await setupNerCommand(makeOptions({ quiet: false }));
    // No error means callbacks were called successfully
    expect(mockDownloadModel).toHaveBeenCalled();
  });

  it("should pass onStatus callback when not quiet", async () => {
    mockIsModelDownloaded.mockResolvedValue(false);
    mockDownloadModel.mockImplementation(async (_mode, _onProgress, onStatus) => {
      onStatus?.("Checking model files...");
      return "/path/to/model";
    });
    await setupNerCommand(makeOptions({ quiet: false }));
    expect(stderrChunks.join("")).toContain("Checking model files...");
  });
});
