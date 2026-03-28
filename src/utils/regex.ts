import type { TagFormat } from "../types/index.js";

/**
 * Escapes special regex characters in a string so it can be used as a literal in a RegExp.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the tag prefix string used for quick `includes()` guard checks.
 * E.g., for default format returns `"<PII"`, for bracket format returns `"[[PII"`.
 */
export function buildTagPrefix(tagFormat: TagFormat): string {
  return `${tagFormat.open}${tagFormat.keyword ?? "PII"}`;
}
