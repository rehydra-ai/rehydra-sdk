/**
 * Plugin Configuration Loader
 * Resolves config from explicit options, env vars, and .rehydra.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RehydraPluginOptions } from "./types.js";

interface ResolvedConfig {
  provider: string;
  envFiles?: string[];
  redactValues?: string[];
  minValueLength: number;
  logStats: boolean;
}

/**
 * Resolves plugin configuration from multiple sources.
 * Precedence: explicit options > env vars > .rehydra.json
 */
export function resolveConfig(
  options: RehydraPluginOptions,
  projectDir: string,
): ResolvedConfig {
  // Try loading .rehydra.json from project root
  let fileConfig: Partial<RehydraPluginOptions> = {};
  try {
    const filePath = resolve(projectDir, ".rehydra.json");
    const content = readFileSync(filePath, "utf-8");
    fileConfig = JSON.parse(content) as Partial<RehydraPluginOptions>;
  } catch {
    // No config file — that's fine
  }

  // Env vars
  const envFiles = process.env["REHYDRA_ENV_FILES"]?.split(",").map((f) => f.trim());
  const envLogStats = process.env["REHYDRA_LOG_STATS"] === "true";

  return {
    provider: options.provider,
    envFiles: options.envFiles ?? envFiles ?? fileConfig.envFiles,
    redactValues: options.redactValues ?? fileConfig.redactValues,
    minValueLength: options.minValueLength ?? fileConfig.minValueLength ?? 8,
    logStats: options.logStats ?? envLogStats ?? fileConfig.logStats ?? false,
  };
}
