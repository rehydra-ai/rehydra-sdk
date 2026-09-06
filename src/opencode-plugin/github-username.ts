import { DetectionSource, PIIType, type SpanMatch } from "../types/index.js";
import type { Recognizer } from "../recognizers/index.js";

const LOGIN = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?`;

export const githubUsernameRecognizer: Recognizer = {
  type: PIIType.GITHUB_USERNAME,
  name: "GitHubUsernameRecognizer",
  defaultConfidence: 1,

  find(text: string): SpanMatch[] {
    const logins = new Set<string>();
    const matches = new Map<number, SpanMatch>();
    function add(start: number, login: string): void {
      logins.add(login);
      matches.set(start, {
        type: PIIType.GITHUB_USERNAME, start, end: start + login.length,
        confidence: 1, source: DetectionSource.REGEX, text: login,
      });
    }
    // Restrict JSON matches to values, so a login like "id" cannot mask JSON keys.
    for (const match of text.matchAll(new RegExp(String.raw`"login"\s*:\s*"(${LOGIN})"`, 'g'))) {
      add(match.index + match[0].lastIndexOf(match[1]!), match[1]!);
    }
    for (const match of text.matchAll(/^(?:author|assignees|reviewers):[\t ]*(.+)$/gim)) {
      const list = match[1]!;
      const offset = match.index + match[0].indexOf(list);
      const entry = new RegExp(String.raw`(?:^|,)[\t ]*(${LOGIN})(?=[\t ,(]|$)`, 'g');
      for (const item of list.matchAll(entry)) {
        add(offset + item.index + item[0].lastIndexOf(item[1]!), item[1]!);
      }
    }
    // Cover mentions of discovered participants, but preserve npm scopes.
    for (const login of logins) {
      const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const match of text.matchAll(new RegExp(`(?<![A-Za-z0-9_/@])@(${escaped})(?![A-Za-z0-9-/])`, 'gi'))) {
        const value = match[1]!;
        matches.set(match.index + 1, { type: PIIType.GITHUB_USERNAME, start: match.index + 1,
          end: match.index + 1 + value.length, confidence: 1, source: DetectionSource.REGEX, text: value });
      }
    }
    return [...matches.values()];
  },
};
