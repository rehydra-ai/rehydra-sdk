/**
 * Literal Value Recognizer
 * Scans for exact occurrences of known secret values (e.g., from .env files)
 */

import { PIIType, type SpanMatch, DetectionSource } from "../../types/index.js";
import type { Recognizer } from "../base.js";

const COMMON_NON_SECRET_VALUES = new Set([
  "true", "false", "yes", "no", "on", "off",
  "null", "undefined", "none",
  "0", "1", "localhost", "127.0.0.1", "0.0.0.0",
  "development", "production", "staging", "test",
  "utf-8", "utf8", "ascii",
]);

/**
 * Creates a recognizer that matches exact known secret values in text.
 */
export function createLiteralValueRecognizer(
  values: string[],
  minLength: number = 4,
): Recognizer {
  // Filter out short and common values
  const secretValues = values.filter(
    (v) => v.length >= minLength && !COMMON_NON_SECRET_VALUES.has(v.toLowerCase()),
  );

  // Sort by length descending so longer matches are found first
  secretValues.sort((a, b) => b.length - a.length);

  return {
    type: PIIType.ENV_VAR_SECRET,
    name: "Literal Secret Value",
    defaultConfidence: 1.0,

    find(text: string): SpanMatch[] {
      const matches: SpanMatch[] = [];

      for (const value of secretValues) {
        let start = 0;
        while (start < text.length) {
          const idx = text.indexOf(value, start);
          if (idx === -1) break;

          matches.push({
            type: PIIType.ENV_VAR_SECRET,
            start: idx,
            end: idx + value.length,
            confidence: 1.0,
            source: DetectionSource.REGEX,
            text: value,
          });

          start = idx + value.length;
        }
      }

      return matches;
    },
  };
}
