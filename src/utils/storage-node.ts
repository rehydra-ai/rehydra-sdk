/**
 * Node.js Storage Provider
 * Implements StorageProvider using Node.js fs/promises
 */

import * as fs from "fs/promises";
import * as nodePath from "path";
import * as os from "os";
import type { StorageProvider } from "./storage.js";

/**
 * Node.js implementation of StorageProvider
 * Uses fs/promises for file operations
 */
export class NodeStorageProvider implements StorageProvider {
  /**
   * Reads a file as binary data
   */
  async readFile(path: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(path);
    return new Uint8Array(buffer);
  }

  /**
   * Reads a file as text
   */
  async readTextFile(path: string, encoding?: string): Promise<string> {
    // Handle latin1 encoding (used by nam_dict.txt)
    const nodeEncoding = encoding === "latin1" ? "latin1" : "utf-8";
    return fs.readFile(path, { encoding: nodeEncoding as BufferEncoding });
  }

  /**
   * Writes data to a file
   */
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    // Ensure parent directory exists
    const dir = nodePath.dirname(path);
    await fs.mkdir(dir, { recursive: true });

    if (typeof data === "string") {
      await fs.writeFile(path, data, "utf-8");
    } else {
      await fs.writeFile(path, data);
    }
  }

  /**
   * Checks if a file or directory exists
   */
  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a directory
   */
  async mkdir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  /**
   * Removes a file or directory
   */
  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    await fs.rm(path, {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  }

  /**
   * Gets the platform-specific cache directory
   */
  getCacheDir(subdir: string): string {
    const homeDir = os.homedir();

    let baseDir: string;
    switch (process.platform) {
      case "darwin":
        baseDir = nodePath.join(homeDir, "Library", "Caches");
        break;
      case "win32":
        baseDir =
          process.env["LOCALAPPDATA"] ??
          nodePath.join(homeDir, "AppData", "Local");
        break;
      default:
        // Linux and others - use XDG_CACHE_HOME or ~/.cache
        baseDir =
          process.env["XDG_CACHE_HOME"] ?? nodePath.join(homeDir, ".cache");
        break;
    }

    return nodePath.join(baseDir, "bridge-anonymization", subdir);
  }
}

