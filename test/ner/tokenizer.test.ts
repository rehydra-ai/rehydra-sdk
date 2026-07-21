/**
 * Tokenizer Tests
 * Tests for WordPiece/Unigram tokenizer functionality
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  WordPieceTokenizer,
  DEFAULT_TOKENIZER_CONFIG,
  loadVocabFromFile,
} from "../../src/ner/tokenizer.js";
import { isModelDownloaded, ensureModel } from "../../src/ner/model-manager.js";

describe("WordPieceTokenizer", () => {
  describe("configuration", () => {
    it("should have correct default config", () => {
      expect(DEFAULT_TOKENIZER_CONFIG.maxLength).toBe(512);
      expect(DEFAULT_TOKENIZER_CONFIG.doLowerCase).toBe(false);
    });
  });

  describe("with mock vocab", () => {
    let tokenizer: WordPieceTokenizer;

    beforeAll(() => {
      // Create a simple mock vocab for testing
      const mockVocab = new Map<string, number>([
        ["[UNK]", 0],
        ["[CLS]", 1],
        ["[SEP]", 2],
        ["[PAD]", 3],
        ["hello", 4],
        ["world", 5],
        ["john", 6],
        ["smith", 7],
        ["▁hello", 8], // SentencePiece style
        ["▁world", 9],
        ["▁john", 10],
        ["▁smith", 11],
        ["▁", 12],
      ]);

      tokenizer = new WordPieceTokenizer(mockVocab);
    });

    it("should have correct vocab size", () => {
      expect(tokenizer.vocab.size).toBe(13);
    });

    it("should get token ID", () => {
      expect(tokenizer.getTokenId("hello")).toBe(4);
      expect(tokenizer.getTokenId("[UNK]")).toBe(0);
    });

    it("should return undefined for unknown tokens", () => {
      expect(tokenizer.getTokenId("nonexistent")).toBeUndefined();
    });

    it("should tokenize simple text", () => {
      const result = tokenizer.tokenize("hello");

      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.inputIds.length).toBe(result.tokens.length);
      expect(result.attentionMask.length).toBe(result.tokens.length);
      expect(result.tokenTypeIds.length).toBe(result.tokens.length);
    });

    it("should include special tokens", () => {
      const result = tokenizer.tokenize("hello");

      // First token should be CLS
      expect(result.tokens[0]?.token).toBe("[CLS]");
      expect(result.tokens[0]?.isSpecial).toBe(true);

      // Last token should be SEP
      expect(result.tokens[result.tokens.length - 1]?.token).toBe("[SEP]");
      expect(result.tokens[result.tokens.length - 1]?.isSpecial).toBe(true);
    });

    it("should set attention mask to 1", () => {
      const result = tokenizer.tokenize("hello world");

      expect(result.attentionMask.every((m) => m === 1)).toBe(true);
    });

    it("should set token type IDs to 0", () => {
      const result = tokenizer.tokenize("hello world");

      expect(result.tokenTypeIds.every((t) => t === 0)).toBe(true);
    });

    it("should track character offsets", () => {
      const result = tokenizer.tokenize("hello");

      // Skip CLS and SEP tokens
      const contentTokens = result.tokens.filter((t) => !t.isSpecial);

      for (const token of contentTokens) {
        expect(token.start).toBeGreaterThanOrEqual(0);
        expect(token.end).toBeGreaterThan(token.start);
      }
    });

    it("should handle empty text", () => {
      const result = tokenizer.tokenize("");

      // Should still have CLS and SEP
      expect(result.tokens.length).toBe(2);
      expect(result.tokens[0]?.token).toBe("[CLS]");
      expect(result.tokens[1]?.token).toBe("[SEP]");
    });

    it("should provide tokenToCharSpan mapping", () => {
      const result = tokenizer.tokenize("hello");

      expect(result.tokenToCharSpan.length).toBe(result.tokens.length);

      // Special tokens should have null spans
      expect(result.tokenToCharSpan[0]).toBeNull(); // CLS
      expect(
        result.tokenToCharSpan[result.tokenToCharSpan.length - 1]
      ).toBeNull(); // SEP
    });
  });

  describe("tokenizeWindows", () => {
    const mockVocab = new Map<string, number>([
      ["[UNK]", 0],
      ["[CLS]", 1],
      ["[SEP]", 2],
      ["[PAD]", 3],
      ["▁hello", 4],
      ["▁world", 5],
      ["▁john", 6],
      ["▁smith", 7],
    ]);

    it("should return a single window identical to tokenize() for short text", () => {
      const tokenizer = new WordPieceTokenizer(mockVocab);
      const text = "hello world";

      const windows = tokenizer.tokenizeWindows(text);

      expect(windows.length).toBe(1);
      expect(windows[0]!.inputIds).toEqual(tokenizer.tokenize(text).inputIds);
      expect(windows[0]!.coreCharStart).toBe(0);
      expect(windows[0]!.coreCharEnd).toBe(text.length);
    });

    it("should produce multiple overlapping windows for long text", () => {
      // maxLength 12 -> 10 content tokens per window
      const tokenizer = new WordPieceTokenizer(mockVocab, { maxLength: 12 });
      const text = "hello world ".repeat(20).trim(); // 40 tokens

      const windows = tokenizer.tokenizeWindows(text, 4);

      expect(windows.length).toBeGreaterThan(1);

      for (const window of windows) {
        expect(window.tokens.length).toBeLessThanOrEqual(12);
        expect(window.tokens[0]?.token).toBe("[CLS]");
        expect(window.tokens[window.tokens.length - 1]?.token).toBe("[SEP]");
      }

      // Consecutive windows share tokens (overlap)
      for (let i = 1; i < windows.length; i++) {
        const prevContent = windows[i - 1]!.tokens.filter((t) => !t.isSpecial);
        const currContent = windows[i]!.tokens.filter((t) => !t.isSpecial);
        expect(currContent[0]!.start).toBeLessThan(
          prevContent[prevContent.length - 1]!.end
        );
      }
    });

    it("should tile core ranges exactly over the full text", () => {
      const tokenizer = new WordPieceTokenizer(mockVocab, { maxLength: 12 });
      const text = "hello world ".repeat(20).trim();

      const windows = tokenizer.tokenizeWindows(text, 4);

      expect(windows[0]!.coreCharStart).toBe(0);
      expect(windows[windows.length - 1]!.coreCharEnd).toBe(text.length);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]!.coreCharStart).toBe(windows[i - 1]!.coreCharEnd);
      }
    });

    it("should cover every token exactly once across window cores", () => {
      const tokenizer = new WordPieceTokenizer(mockVocab, { maxLength: 12 });
      const text = "hello world ".repeat(20) + "john smith";

      // Reference: untruncated tokenization
      const reference = new WordPieceTokenizer(mockVocab, {
        maxLength: 100000,
      })
        .tokenize(text)
        .tokens.filter((t) => !t.isSpecial)
        .map((t) => [t.start, t.end]);

      const covered = tokenizer
        .tokenizeWindows(text, 4)
        .flatMap((w) =>
          w.tokens
            .filter(
              (t) =>
                !t.isSpecial &&
                t.start >= w.coreCharStart &&
                t.start < w.coreCharEnd
            )
            .map((t) => [t.start, t.end])
        );

      expect(covered).toEqual(reference);
    });

    it("should terminate and cover all tokens for degenerate maxLength", () => {
      // maxLength <= 2 leaves no room for content tokens; must not hang
      const tokenizer = new WordPieceTokenizer(mockVocab, { maxLength: 2 });
      const text = "hello world hello world";

      const windows = tokenizer.tokenizeWindows(text);

      const covered = windows.flatMap((w) =>
        w.tokens.filter(
          (t) =>
            !t.isSpecial &&
            t.start >= w.coreCharStart &&
            t.start < w.coreCharEnd
        )
      );
      expect(covered.length).toBe(4);
    });

    it("should cover continuation tokens exactly once when windows split mid-word", () => {
      // 'abcd' tokenizes as ▁ab + cd, so window and core boundaries can
      // fall inside a word — the normal case with a real subword vocab
      const subwordVocab = new Map<string, number>([
        ["[UNK]", 0],
        ["[CLS]", 1],
        ["[SEP]", 2],
        ["[PAD]", 3],
        ["▁ab", 4],
        ["cd", 5],
      ]);
      const tokenizer = new WordPieceTokenizer(subwordVocab, {
        maxLength: 13,
      });
      const text = "abcd ".repeat(40).trim(); // 80 tokens

      const reference = new WordPieceTokenizer(subwordVocab, {
        maxLength: 100000,
      })
        .tokenize(text)
        .tokens.filter((t) => !t.isSpecial)
        .map((t) => [t.start, t.end, t.isContinuation]);

      const windows = tokenizer.tokenizeWindows(text, 4);
      const covered = windows.flatMap((w) =>
        w.tokens
          .filter(
            (t) =>
              !t.isSpecial &&
              t.start >= w.coreCharStart &&
              t.start < w.coreCharEnd
          )
          .map((t) => [t.start, t.end, t.isContinuation])
      );

      expect(covered).toEqual(reference);

      // The scenario must actually occur: some window starts mid-word
      expect(
        windows.some((w) => w.tokens[1]?.isContinuation === true)
      ).toBe(true);
    });

    it("should include tokens past the single-window truncation point", () => {
      const tokenizer = new WordPieceTokenizer(mockVocab, { maxLength: 12 });
      const text = "hello world ".repeat(20) + "john smith";
      const johnOffset = text.indexOf("john");

      const truncated = tokenizer.tokenize(text);
      const truncatedMax = Math.max(
        ...truncated.tokens.filter((t) => !t.isSpecial).map((t) => t.end)
      );
      expect(truncatedMax).toBeLessThan(johnOffset);

      const windows = tokenizer.tokenizeWindows(text, 4);
      const owner = windows.find(
        (w) => johnOffset >= w.coreCharStart && johnOffset < w.coreCharEnd
      );
      expect(owner).toBeDefined();
      expect(
        owner!.tokens.some((t) => !t.isSpecial && t.start === johnOffset)
      ).toBe(true);
    });
  });

  describe("with real vocab (integration)", () => {
    let tokenizer: WordPieceTokenizer | null = null;
    let modelAvailable = false;
    const isCI = process.env.CI === "true";

    beforeAll(async () => {
      // Skip in CI - model files are too large
      if (isCI) return;

      // Check if model is downloaded
      modelAvailable = await isModelDownloaded("quantized");

      if (modelAvailable) {
        const { vocabPath } = await ensureModel("quantized", {
          autoDownload: false,
        });
        const vocab = await loadVocabFromFile(vocabPath);
        tokenizer = new WordPieceTokenizer(vocab);
      }
    });

    it("should load vocab from file", () => {
      if (isCI || !modelAvailable) return;
      expect(tokenizer).not.toBeNull();
      expect(tokenizer!.vocab.size).toBeGreaterThan(10000);
    });

    it("should tokenize English text", () => {
      if (isCI || !modelAvailable) return;
      const result = tokenizer!.tokenize("Hello, my name is John Smith.");

      expect(result.tokens.length).toBeGreaterThan(2); // More than just CLS/SEP

      // Verify we got reasonable tokens
      const tokenTexts = result.tokens
        .filter((t) => !t.isSpecial)
        .map((t) => t.token);
      expect(tokenTexts.length).toBeGreaterThan(0);
    });

    it("should tokenize German text", () => {
      if (isCI || !modelAvailable) return;
      const result = tokenizer!.tokenize(
        "Guten Tag, mein Name ist Hans Müller."
      );

      expect(result.tokens.length).toBeGreaterThan(2);

      const tokenTexts = result.tokens
        .filter((t) => !t.isSpecial)
        .map((t) => t.token);
      expect(tokenTexts.length).toBeGreaterThan(0);
    });

    it("should handle multi-word entities", () => {
      if (isCI || !modelAvailable) return;
      const text = "John Smith works at Apple Inc in New York City.";
      const result = tokenizer!.tokenize(text);

      // Verify character offsets are within bounds
      for (const token of result.tokens) {
        if (!token.isSpecial) {
          expect(token.start).toBeGreaterThanOrEqual(0);
          expect(token.end).toBeLessThanOrEqual(text.length);
          expect(token.start).toBeLessThan(token.end);
        }
      }
    });

    it("should respect maxLength", () => {
      if (isCI || !modelAvailable) return;
      // Create a very long text
      const longText = "word ".repeat(1000);
      const result = tokenizer!.tokenize(longText);

      expect(result.tokens.length).toBeLessThanOrEqual(
        DEFAULT_TOKENIZER_CONFIG.maxLength
      );
    });

    it("should handle special characters", () => {
      if (isCI || !modelAvailable) return;
      const result = tokenizer!.tokenize(
        "Email: test@example.com, Phone: +49-123-456789"
      );

      expect(result.tokens.length).toBeGreaterThan(2);
    });

    it("should handle Unicode", () => {
      if (isCI || !modelAvailable) return;
      const result = tokenizer!.tokenize("北京 is the capital of 中国");

      expect(result.tokens.length).toBeGreaterThan(2);
    });
  });
});
