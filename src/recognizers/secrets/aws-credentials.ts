/**
 * AWS Credentials Recognizer
 * Detects AWS access key IDs (AKIA prefix) and context-dependent secret keys
 */

import { PIIType, type SpanMatch, DetectionSource } from "../../types/index.js";
import type { Recognizer } from "../base.js";

const AWS_ACCESS_KEY_PATTERN = /\bAKIA[A-Z0-9]{16}\b/g;

const AWS_SECRET_CONTEXT_KEYWORDS = /(?:aws_secret_access_key|secret_access_key|aws_secret|secretaccesskey)/i;

const AWS_SECRET_KEY_PATTERN = /\b[A-Za-z0-9/+=]{40}\b/g;

export const awsCredentialsRecognizer: Recognizer = {
  type: PIIType.AWS_CREDENTIALS,
  name: "AWS Credentials",
  defaultConfidence: 0.98,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    const seen = new Set<string>();

    // Always detect AKIA access key IDs (high confidence, distinctive prefix)
    for (const match of text.matchAll(AWS_ACCESS_KEY_PATTERN)) {
      if (match.index === undefined) continue;
      const key = `${match.index}:${match.index + match[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({
        type: PIIType.AWS_CREDENTIALS,
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.98,
        source: DetectionSource.REGEX,
        text: match[0],
      });
    }

    // Only scan for 40-char secret keys if there's context suggesting AWS secrets
    if (AWS_SECRET_CONTEXT_KEYWORDS.test(text)) {
      for (const match of text.matchAll(AWS_SECRET_KEY_PATTERN)) {
        if (match.index === undefined) continue;
        const matchText = match[0];
        const key = `${match.index}:${match.index + matchText.length}`;
        if (seen.has(key)) continue;

        // Must contain mixed case + digits/special to look like a secret
        if (!/[a-z]/.test(matchText) || !/[A-Z]/.test(matchText)) continue;
        if (!/[0-9/+=]/.test(matchText)) continue;

        seen.add(key);
        matches.push({
          type: PIIType.AWS_CREDENTIALS,
          start: match.index,
          end: match.index + matchText.length,
          confidence: 0.85,
          source: DetectionSource.REGEX,
          text: matchText,
        });
      }
    }

    return matches;
  },

  validate(match: string): boolean {
    // AKIA keys are always valid
    if (match.startsWith("AKIA") && match.length === 20) return true;
    // Secret keys must be exactly 40 chars
    return match.length === 40;
  },
};
