/**
 * Environment Variable Secret Recognizer
 * Detects secrets in .env-style KEY=VALUE lines
 */

import { PIIType, type SpanMatch, DetectionSource } from "../../types/index.js";
import type { Recognizer } from "../base.js";
import { isSecretKeyName } from "./key-patterns.js";

const ENV_VAR_LINE = /^[ \t]*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*["']?(.+?)["']?$/gm;

const PLACEHOLDER_VALUES = new Set([
  "changeme", "your-api-key-here", "your_api_key_here",
  "xxx", "yyy", "zzz", "todo", "fixme", "replace_me",
  "example", "test", "dummy", "placeholder",
]);

const DEFAULT_MIN_LENGTH = 8;

export function createEnvVarSecretRecognizer(
  minValueLength: number = DEFAULT_MIN_LENGTH,
  extraKeyPatterns: RegExp[] = [],
): Recognizer {
  return {
    type: PIIType.ENV_VAR_SECRET,
    name: "Environment Variable Secret",
    defaultConfidence: 0.88,

    find(text: string): SpanMatch[] {
      const matches: SpanMatch[] = [];

      for (const match of text.matchAll(ENV_VAR_LINE)) {
        if (match.index === undefined) continue;
        const key = match[1]!;
        const value = match[2]!;

        // Check if key name suggests a secret
        const keyIsSecret = isSecretKeyName(key)
          || extraKeyPatterns.some((p) => p.test(key));
        if (!keyIsSecret) continue;

        // Filter out short or placeholder values
        if (value.length < minValueLength) continue;
        if (PLACEHOLDER_VALUES.has(value.toLowerCase())) continue;

        // Span covers the VALUE portion only
        const fullLine = match[0];
        const valueStartInLine = fullLine.lastIndexOf(value);
        const valueStart = match.index + valueStartInLine;

        matches.push({
          type: PIIType.ENV_VAR_SECRET,
          start: valueStart,
          end: valueStart + value.length,
          confidence: 0.88,
          source: DetectionSource.REGEX,
          text: value,
        });
      }

      return matches;
    },
  };
}

export const envVarSecretRecognizer = createEnvVarSecretRecognizer();
