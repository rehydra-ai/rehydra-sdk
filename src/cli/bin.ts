#!/usr/bin/env node

import { run } from "./main.js";
import { CLIError } from "./utils/errors.js";

try {
  const exitCode = await run();
  process.exitCode = exitCode;
} catch (err) {
  if (err instanceof CLIError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = err.exitCode;
  } else {
    process.stderr.write(
      `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  }
}
