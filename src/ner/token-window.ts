import type { SpanMatch } from "../types/index.js";
import type { Token, TokenizationResult } from "./tokenizer.js";

function buildTokenization(tokens: Token[]): TokenizationResult {
  return {
    tokens,
    inputIds: tokens.map((token) => token.id),
    attentionMask: tokens.map(() => 1),
    tokenTypeIds: tokens.map(() => 0),
    tokenToCharSpan: tokens.map((token) =>
      token.isSpecial ? null : [token.start, token.end],
    ),
    // A window is a complete slice of an already-tokenized input; the
    // truncated signal lives on the parent tokenization, not each window.
    truncated: false,
  };
}

/**
 * Total token count (including the two special tokens) that `maxWindows`
 * windows can consume. Used to bound tokenization up front so huge inputs
 * are not fully tokenized just to discard everything past the cap.
 */
export function windowTokenBudget(
  maxLength: number,
  overlapTokens: number,
  maxWindows: number,
): number {
  validateWindowConfig(maxLength, overlapTokens, maxWindows);
  const contentCapacity = maxLength - 2;
  const stride = contentCapacity - overlapTokens;
  return 2 + contentCapacity + (maxWindows - 1) * stride;
}

export function validateWindowConfig(
  maxLength: number,
  overlapTokens: number,
  maxWindows?: number,
): void {
  if (maxLength - 2 < 1) {
    throw new Error("NER maxLength must leave room for content and two special tokens");
  }
  if (overlapTokens < 0 || overlapTokens >= maxLength - 2) {
    throw new Error("NER window overlap must be smaller than the content capacity");
  }
  if (maxWindows !== undefined && maxWindows < 1) {
    throw new Error("NER maxWindowsPerInput must be at least 1");
  }
}

/**
 * Splits an already-tokenized input into overlapping model-sized windows.
 * The window count is bounded by the caller pre-bounding tokenization via
 * `tokenize`'s `maxTokens` (see `runNERPass`) — this just slices whatever it
 * is handed, so a truncated tokenization yields a truncated set of windows,
 * and the truncation signal lives on the parent `TokenizationResult`.
 */
export function createTokenWindows(
  tokenization: TokenizationResult,
  maxLength: number,
  overlapTokens: number,
): TokenizationResult[] {
  validateWindowConfig(maxLength, overlapTokens);
  const contentCapacity = maxLength - 2;
  if (tokenization.tokens.length <= maxLength) {
    return [tokenization];
  }

  const firstToken = tokenization.tokens[0];
  const lastToken = tokenization.tokens[tokenization.tokens.length - 1];
  if (
    firstToken === undefined ||
    firstToken.isSpecial !== true ||
    lastToken === undefined ||
    lastToken.isSpecial !== true
  ) {
    throw new Error("NER tokenization must include leading and trailing special tokens");
  }

  const contentTokens = tokenization.tokens.slice(1, -1);
  const stride = contentCapacity - overlapTokens;
  const windows: TokenizationResult[] = [];

  for (let start = 0; start < contentTokens.length; start += stride) {
    const end = Math.min(start + contentCapacity, contentTokens.length);
    windows.push(
      buildTokenization([firstToken, ...contentTokens.slice(start, end), lastToken]),
    );
    if (end === contentTokens.length) break;
  }

  return windows;
}

export function mergeWindowSpans(
  spans: SpanMatch[],
  originalText: string,
): SpanMatch[] {
  const sorted = [...spans].sort((a, b) =>
    a.start - b.start || b.end - a.end || b.confidence - a.confidence,
  );
  const merged: SpanMatch[] = [];

  for (const span of sorted) {
    let combined = span;
    for (let index = merged.length - 1; index >= 0; index--) {
      const existing = merged[index]!;
      // Only stitch spans that actually overlap (touching end-to-start is not
      // an overlap). This relies on the window overlap being at least as long
      // as the longest expected entity — otherwise an entity split across a
      // window boundary produces two abutting fragments that never merge.
      // The default overlap (64 tokens) is far longer than any name/entity.
      if (
        existing.type !== combined.type ||
        existing.start >= combined.end ||
        combined.start >= existing.end
      ) {
        continue;
      }

      const preferred = combined.confidence > existing.confidence
        ? combined
        : existing;
      const start = Math.min(existing.start, combined.start);
      const end = Math.max(existing.end, combined.end);
      combined = {
        ...preferred,
        start,
        end,
        text: originalText.slice(start, end),
      };
      merged.splice(index, 1);
    }
    merged.push(combined);
  }

  return merged.sort((a, b) => a.start - b.start || b.end - a.end);
}
