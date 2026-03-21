#!/usr/bin/env node

// Node 18 does not expose globalThis.crypto by default
import { webcrypto } from "node:crypto";
if (globalThis.crypto === undefined) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  globalThis.crypto = webcrypto as any;
}

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
