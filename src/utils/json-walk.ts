/**
 * Recursive JSON Walker
 * Walks a JSON-serializable value and transforms all string leaves.
 */

/**
 * Async function that transforms a string value.
 */
export type StringProcessor = (s: string) => Promise<string>;

/**
 * Recursively walks a JSON-serializable value and applies a string processor
 * to every string leaf. Returns a deep copy with all strings transformed.
 *
 * Strings are processed **sequentially** to ensure deterministic PII ID
 * assignment when used with session.anonymize().
 *
 * @param value - Any JSON-serializable value (object, array, string, number, boolean, null)
 * @param processString - Async function to transform each string leaf
 * @returns Deep copy of the value with all strings transformed
 */
export async function walkJson<T>(
  value: T,
  processString: StringProcessor,
): Promise<T> {
  // null
  if (value === null || value === undefined) {
    return value;
  }

  // string — process it
  if (typeof value === "string") {
    return (await processString(value)) as T;
  }

  // non-object primitives (number, boolean) — pass through
  if (typeof value !== "object") {
    return value;
  }

  // array — walk each element sequentially
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await walkJson(item, processString));
    }
    return result as T;
  }

  // plain object — walk each own enumerable property sequentially
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = await walkJson(
      (value as Record<string, unknown>)[key],
      processString,
    );
  }
  return result as T;
}
