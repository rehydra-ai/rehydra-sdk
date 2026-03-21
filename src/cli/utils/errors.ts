/**
 * CLI-specific error with exit code
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CLIError";
  }
}
