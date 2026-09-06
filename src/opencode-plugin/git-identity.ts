import { DetectionSource, PIIType, type SpanMatch } from "../types/index.js";
import type { Recognizer } from "../recognizers/index.js";

export const gitIdentityRecognizer: Recognizer = {
  type: PIIType.PERSON,
  name: "GitIdentityRecognizer",
  defaultConfidence: 1,

  find(text: string): SpanMatch[] {
    const names = new Set<string>();

    for (const match of text.matchAll(/^(?:Author|Commit|Committer):[\t ]*(.+)$/gm)) {
      names.add(match[1]!.replace(/[\t ]+<[^>]*>.*$/, "").trim());
    }
    for (const match of text.matchAll(/^(?:author|committer) (.+)$/gm)) {
      names.add(match[1]!.replace(/[\t ]+<[^>]*>.*$/, '').trim());
    }
    for (const match of text.matchAll(/^.*\((.+?)\s+\d{4}-\d{2}-\d{2}\s[^)\n]*\)/gm)) {
      names.add(match[1]!.trim());
    }

    const matches: SpanMatch[] = [];
    for (const name of names) {
      if (name === "") continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      for (const match of text.matchAll(pattern)) {
        matches.push({
          type: PIIType.PERSON,
          start: match.index,
          end: match.index + match[0].length,
          confidence: 1,
          source: DetectionSource.REGEX,
          text: match[0],
        });
      }
    }

    return matches;
  },
};
