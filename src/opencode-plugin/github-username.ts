import { DetectionSource, PIIType, type SpanMatch } from "../types/index.js";
import type { Recognizer } from "../recognizers/index.js";

const LOGIN = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?`;

export const githubUsernameRecognizer: Recognizer = {
  type: PIIType.GITHUB_USERNAME,
  name: "GitHubUsernameRecognizer",
  defaultConfidence: 1,

  find(text: string): SpanMatch[] {
    const logins = new Set<string>();

    const jsonLoginPattern = new RegExp(
      String.raw`"login"\s*:\s*"(${LOGIN})"`,
      "g",
    );
    for (const match of text.matchAll(jsonLoginPattern)) {
      logins.add(match[1]!);
    }

    const summaryLoginPattern = new RegExp(
      String.raw`^(?:author|assignees|reviewers):\s*(.+)$`,
      "gm",
    );
    for (const match of text.matchAll(summaryLoginPattern)) {
      for (const value of match[1]!.split(",")) {
        const login = value.trim().match(new RegExp(`^(${LOGIN})`))?.[1];
        if (login !== undefined) logins.add(login);
      }
    }

    const matches: SpanMatch[] = [];
    for (const login of logins) {
      const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`,
        "gi",
      );
      for (const match of text.matchAll(pattern)) {
        matches.push({
          type: PIIType.GITHUB_USERNAME,
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
