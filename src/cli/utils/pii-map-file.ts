import { readFile, writeFile } from "node:fs/promises";
import type { EncryptedPIIMap } from "../../types/index.js";
import { CLIError } from "./errors.js";

export interface PIIMapFile {
  version: 1;
  createdAt: string;
  key?: string;
  piiMap: EncryptedPIIMap;
  stats: {
    totalEntities: number;
    countsByType: Record<string, number>;
  };
}

export async function savePIIMapFile(
  path: string,
  data: PIIMapFile,
): Promise<void> {
  const json = JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, json, "utf-8");
}

export async function loadPIIMapFile(path: string): Promise<PIIMapFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CLIError(`PII map file not found: ${path}`);
    }
    throw new CLIError(`Failed to read PII map file: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CLIError(`Invalid JSON in PII map file: ${path}`);
  }

  const file = parsed as PIIMapFile;
  if (file.version !== 1 || file.piiMap === undefined) {
    throw new CLIError(
      `Invalid PII map file format: ${path}`,
    );
  }

  return file;
}
