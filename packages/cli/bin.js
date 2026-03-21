#!/usr/bin/env node

import { run } from "rehydra/cli";

try {
  const exitCode = await run();
  process.exitCode = exitCode;
} catch (err) {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
}
