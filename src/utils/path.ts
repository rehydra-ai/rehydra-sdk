/**
 * Browser-safe path utilities
 * Replaces Node.js path module for cross-platform compatibility
 */

/**
 * Joins path segments with forward slashes
 * Normalizes the result to remove redundant separators
 */
export function join(...parts: string[]): string {
  const joined = parts
    .filter((part) => part !== "")
    .join("/")
    .replace(/\/+/g, "/");

  return normalize(joined);
}

/**
 * Returns the directory name of a path
 * @example dirname('/foo/bar/baz.txt') => '/foo/bar'
 */
export function dirname(path: string): string {
  const normalized = normalize(path);
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash === -1) {
    return ".";
  }

  if (lastSlash === 0) {
    return "/";
  }

  return normalized.slice(0, lastSlash);
}

/**
 * Returns the last portion of a path (the filename)
 * @example basename('/foo/bar/baz.txt') => 'baz.txt'
 */
export function basename(path: string): string {
  const normalized = normalize(path);
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash === -1) {
    return normalized;
  }

  return normalized.slice(lastSlash + 1);
}

/**
 * Normalizes a path by resolving . and .. segments
 * and removing redundant slashes
 */
export function normalize(path: string): string {
  // Replace backslashes with forward slashes (Windows compatibility)
  let normalized = path.replace(/\\/g, "/");

  // Remove redundant slashes (but keep leading // for UNC paths if needed)
  normalized = normalized.replace(/\/+/g, "/");

  // Handle . and .. segments
  const parts = normalized.split("/");
  const result: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      // Don't pop past root
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!normalized.startsWith("/")) {
        result.push("..");
      }
    } else if (part !== "." && part !== "") {
      result.push(part);
    }
  }

  // Preserve leading slash
  const prefix = normalized.startsWith("/") ? "/" : "";
  const joined = result.join("/");

  return prefix + joined || ".";
}

/**
 * Returns the extension of a path
 * @example extname('/foo/bar/baz.txt') => '.txt'
 */
export function extname(path: string): string {
  const base = basename(path);
  const dotIndex = base.lastIndexOf(".");

  if (dotIndex <= 0) {
    return "";
  }

  return base.slice(dotIndex);
}

/**
 * Checks if a path is absolute
 */
export function isAbsolute(path: string): boolean {
  // Unix absolute paths start with /
  // Windows absolute paths start with drive letter (C:) or UNC (\\)
  return (
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.startsWith("\\\\")
  );
}

