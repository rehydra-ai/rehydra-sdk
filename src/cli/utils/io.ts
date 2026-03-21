import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { text } from "node:stream/consumers";
import { CLIError } from "./errors.js";

/**
 * Read input from a file path or stdin.
 * Throws CLIError if no file and stdin is a TTY (no piped data).
 */
export async function readInput(filePath?: string): Promise<string> {
  if (filePath !== undefined) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new CLIError(`File not found: ${filePath}`);
      }
      throw new CLIError(`Failed to read file: ${filePath}`);
    }
  }

  if (process.stdin.isTTY === true) {
    throw new CLIError(
      "No input: provide a file argument or pipe data via stdin",
    );
  }

  return text(process.stdin);
}

/**
 * Write output to a file path or stdout.
 */
export async function writeOutput(
  data: string,
  filePath?: string,
): Promise<void> {
  if (filePath !== undefined) {
    await writeFile(filePath, data, "utf-8");
  } else {
    process.stdout.write(data);
  }
}

/**
 * Get a readable stream for a file path.
 */
export function getInputStream(filePath: string): Readable {
  return createReadStream(filePath, { encoding: "utf-8" });
}

/**
 * Get a writable stream for output (file or stdout).
 */
export function getOutputStream(filePath?: string): Writable {
  if (filePath !== undefined) {
    return createWriteStream(filePath, { encoding: "utf-8" });
  }
  return process.stdout;
}
