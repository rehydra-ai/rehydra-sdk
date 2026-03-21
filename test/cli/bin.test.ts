import { describe, it, expect } from "vitest";
import { CLIError } from "../../src/cli/utils/errors.js";

describe("CLIError", () => {
  it("should set message and exit code", () => {
    const error = new CLIError("test error", 42);
    expect(error.message).toBe("test error");
    expect(error.exitCode).toBe(42);
    expect(error.name).toBe("CLIError");
  });

  it("should default exit code to 1", () => {
    const error = new CLIError("default exit code");
    expect(error.exitCode).toBe(1);
  });
});
