/**
 * Plugin Configuration Loader
 * Resolves config from explicit options, env vars, and .rehydra.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RehydraPluginOptions, RehydraLogLevel } from "./types.js";

export interface ResolvedConfig {
  provider: string;
  envFiles?: string[];
  redactValues?: string[];
  minValueLength: number;
  logLevel: RehydraLogLevel;
  logFile: string | null;
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
  const envLogLevel = process.env["REHYDRA_LOG_LEVEL"] as RehydraLogLevel | undefined;

  // Resolve log config: new `log` option takes precedence over deprecated `logFile`
  let logLevel: RehydraLogLevel = false;
  let logFile: string | null = null;

  if (options.log !== undefined && options.log !== false) {
    logLevel = options.log.level;
    logFile = options.log.file;
  } else if (options.logFile !== undefined && options.logFile !== "") {
    // Deprecated path: logFile without log → treat as debug
    logLevel = "debug";
    logFile = options.logFile;
  } else if (envLogLevel !== undefined && envLogLevel !== false) {
    logLevel = envLogLevel;
    logFile = process.env["REHYDRA_LOG_FILE"] ?? "rehydra.log";
  } else if (fileConfig.log !== undefined && fileConfig.log !== false) {
    const fc = fileConfig.log as { level: RehydraLogLevel; file: string };
    logLevel = fc.level;
    logFile = fc.file;
  } else if (fileConfig.logFile !== undefined && fileConfig.logFile !== "") {
    logLevel = "debug";
    logFile = fileConfig.logFile;
  }

  return {
    provider: options.provider,
    envFiles: options.envFiles ?? envFiles ?? fileConfig.envFiles,
    redactValues: options.redactValues ?? fileConfig.redactValues,
    minValueLength: options.minValueLength ?? fileConfig.minValueLength ?? 8,
    logLevel,
    logFile,
  };
}
