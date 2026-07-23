import { describe, expect, it } from "vitest";
import { PIIType, DetectionSource, type SpanMatch } from "../../src/types/index.js";
import {
  createTokenWindows,
  mergeWindowSpans,
  windowTokenBudget,
} from "../../src/ner/token-window.js";
import { WordPieceTokenizer } from "../../src/ner/tokenizer.js";

function person(start: number, end: number, text: string, confidence: number): SpanMatch {
  return {
    type: PIIType.PERSON,
    start,
    end,
    text,
    confidence,
    source: DetectionSource.NER,
  };
}

function makeTokenizer(): WordPieceTokenizer {
  return new WordPieceTokenizer(
    new Map<string, number>([
      ["[UNK]", 0],
      ["[CLS]", 1],
      ["[SEP]", 2],
      ["[PAD]", 3],
      ["a", 4],
    ]),
  );
}

describe("NER token windows", () => {
  it("covers the complete token stream with overlapping windows", () => {
    const full = makeTokenizer().tokenize("a".repeat(20), { truncate: false });
    const windows = createTokenWindows(full, 8, 2);

    expect(windows).toHaveLength(5);
    expect(windows.every((window) => window.tokens.length <= 8)).toBe(true);

    const coveredOffsets = new Set(
      windows.flatMap((window) =>
        window.tokens
          .filter((token) => !token.isSpecial)
          .map((token) => token.start),
      ),
    );
    expect([...coveredOffsets].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
  });

  it("returns a single window for input within maxLength", () => {
    const full = makeTokenizer().tokenize("a".repeat(6), { truncate: false });
    const windows = createTokenWindows(full, 8, 2);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toBe(full);
  });

  it("stitches overlapping fragments of the same entity", () => {
    const text = "xxxxJohn Smithxxxx";
    const spans = [
      person(4, 9, "John ", 0.8),
      person(4, 14, "John Smith", 0.9),
      person(9, 14, "Smith", 0.85),
    ];

    expect(mergeWindowSpans(spans, text)).toEqual([
      person(4, 14, "John Smith", 0.9),
    ]);
  });

  it("rejects overlap that leaves no forward progress", () => {
    const full = makeTokenizer().tokenize("a".repeat(20), { truncate: false });

    expect(() => createTokenWindows(full, 8, 6)).toThrow(
      "NER window overlap must be smaller than the content capacity",
    );
  });

  it("caps coverage when tokenization is pre-bounded to a window budget", () => {
    // How runNERPass caps: bound tokenization to the token budget for N
    // windows, then window whatever survives. The leading windows are kept
    // and the parent tokenization carries the truncation signal.
    const budget = windowTokenBudget(8, 2, 2);
    const bounded = makeTokenizer().tokenize("a".repeat(20), {
      truncate: false,
      maxTokens: budget,
    });
    expect(bounded.truncated).toBe(true);

    const windows = createTokenWindows(bounded, 8, 2);
    expect(windows).toHaveLength(2);

    const full = makeTokenizer().tokenize("a".repeat(20), { truncate: false });
    const uncapped = createTokenWindows(full, 8, 2);
    expect(windows[0]).toEqual(uncapped[0]);
    expect(windows[1]).toEqual(uncapped[1]);
  });

  it("rejects a window budget below 1 window", () => {
    expect(() => windowTokenBudget(8, 2, 0)).toThrow("at least 1");
  });
});
