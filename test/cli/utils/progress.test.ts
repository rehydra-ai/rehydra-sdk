import { describe, it, expect } from "vitest";
import { formatProgress } from "../../../src/cli/utils/progress.js";

describe("formatProgress", () => {
  it("should show downloading message when percent is null", () => {
    const result = formatProgress("model.onnx", null);
    expect(result).toBe("  Downloading model.onnx...");
  });

  it("should show progress bar at 0%", () => {
    const result = formatProgress("model.onnx", 0);
    expect(result).toContain("model.onnx");
    expect(result).toContain("0%");
    expect(result).toContain("\u2591"); // empty block
  });

  it("should show progress bar at 50%", () => {
    const result = formatProgress("model.onnx", 50);
    expect(result).toContain("50%");
    expect(result).toContain("\u2588"); // filled block
    expect(result).toContain("\u2591"); // empty block
  });

  it("should show progress bar at 100%", () => {
    const result = formatProgress("model.onnx", 100);
    expect(result).toContain("100%");
    expect(result).toContain("\u2588"); // filled block
    expect(result).not.toContain("\u2591"); // no empty blocks
  });
});
