/**
 * Helpers for scrubbing tool-call arguments, which are JSON values rather than text.
 */

/**
 * Applies `map` to every string in a JSON value, depth-first in key order,
 * and returns the mapped copy. Object keys are left alone.
 *
 * Extraction and rebuilding both walk a value with this function, so the
 * strings line up by index as long as both see the same value.
 */
export function mapJsonStrings(
  value: unknown,
  map: (text: string) => string,
): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => mapJsonStrings(item, map));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapJsonStrings(item, map)]),
    );
  }
  return value;
}

/** Parses tool-call arguments, or returns undefined when they are not valid JSON. */
export function parseJsonArguments(args: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(args) as unknown };
  } catch {
    return undefined;
  }
}
