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

    it("should expose all tokens when truncation is disabled", () => {
      const tokenizerWithShortLimit = new WordPieceTokenizer(
        new Map<string, number>([
          ["[UNK]", 0],
          ["[CLS]", 1],
          ["[SEP]", 2],
          ["[PAD]", 3],
          ["a", 4],
        ]),
        { maxLength: 8 },
      );
      const text = "a".repeat(20);

      expect(tokenizerWithShortLimit.tokenize(text).tokens).toHaveLength(8);
      expect(
        tokenizerWithShortLimit.tokenize(text, { truncate: false }).tokens,
      ).toHaveLength(22);
    });

    it("bounds token count and flags truncation with maxTokens", () => {
      const tok = new WordPieceTokenizer(
        new Map<string, number>([
          ["[UNK]", 0],
          ["[CLS]", 1],
          ["[SEP]", 2],
          ["[PAD]", 3],
          ["a", 4],
        ]),
      );

      // maxTokens wins over truncate:false and caps the array (incl. CLS/SEP).
      const capped = tok.tokenize("a".repeat(20), { truncate: false, maxTokens: 10 });
      expect(capped.tokens).toHaveLength(10);
      expect(capped.tokens.at(-1)?.token).toBe("[SEP]");
      expect(capped.truncated).toBe(true);

      // Input that fits within the budget is not flagged truncated.
      const whole = tok.tokenize("a".repeat(4), { truncate: false, maxTokens: 10 });
      expect(whole.truncated).toBe(false);
      expect(whole.tokens).toHaveLength(6); // CLS + 4 + SEP
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
