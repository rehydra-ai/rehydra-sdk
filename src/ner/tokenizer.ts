/**
 * HuggingFace Tokenizer
 * Loads and uses tokenizers from HuggingFace's tokenizer.json format
 * Supports Unigram (SentencePiece) and BPE tokenizers
 */

/**
 * Token with offset information
 */
export interface Token {
  /** Token ID in vocabulary */
  id: number;
  /** Token string */
  token: string;
  /** Start character offset in original text */
  start: number;
  /** End character offset in original text */
  end: number;
  /** Whether this is a continuation token */
  isContinuation: boolean;
  /** Whether this is a special token */
  isSpecial: boolean;
}

/**
 * Tokenization result with metadata
 */
export interface TokenizationResult {
  /** Array of tokens */
  tokens: Token[];
  /** Input IDs for model */
  inputIds: number[];
  /** Attention mask */
  attentionMask: number[];
  /** Token type IDs (for BERT-style models) */
  tokenTypeIds: number[];
  /** Mapping from token index to character span [start, end] */
  tokenToCharSpan: Array<[number, number] | null>;
}

/**
 * A model-sized window over the full token stream of a long input.
 * Consecutive windows overlap so entities near a window boundary are seen
 * with full context by at least one window. The core range delimits the
 * characters this window is authoritative for: cores tile the input exactly,
 * so an entity anchored (by start offset) in a core belongs to exactly one
 * window and cross-window duplicates cannot occur.
 */
export interface TokenizationWindow extends TokenizationResult {
  /** Start character offset (inclusive) of this window's core range */
  coreCharStart: number;
  /** End character offset (exclusive) of this window's core range */
  coreCharEnd: number;
}

/**
 * Default token overlap between consecutive windows.
 * Entities up to half this length are guaranteed to fit entirely inside
 * the window that owns them.
 */
export const DEFAULT_WINDOW_OVERLAP = 128;

/**
 * HuggingFace tokenizer.json structure
 */
interface HFTokenizerConfig {
  version: string;
  model: {
    type: string;
    vocab: Array<[string, number]> | Record<string, number>;
    merges?: string[];
  };
  added_tokens: Array<{
    id: number;
    content: string;
    special: boolean;
  }>;
  pre_tokenizer?: {
    type: string;
  };
}

/**
 * Tokenizer configuration
 */
export interface TokenizerConfig {
  /** Maximum sequence length */
  maxLength: number;
  /** Whether to lowercase input */
  doLowerCase: boolean;
}

/**
 * Default tokenizer configuration
 */
export const DEFAULT_TOKENIZER_CONFIG: TokenizerConfig = {
  maxLength: 512,
  doLowerCase: false, // XLM-RoBERTa doesn't lowercase
};

/**
 * Trie node for fast prefix matching
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  tokenId: number | null;
  token: string | null;
}

/**
 * Creates a new trie node
 */
function createTrieNode(): TrieNode {
  return { children: new Map(), tokenId: null, token: null };
}

/**
 * WordPiece Tokenizer - supports both HuggingFace JSON and vocab.txt formats
 * Uses a Trie for O(token_length) lookups instead of O(vocab_size)
 */
export class WordPieceTokenizer {
  private vocab: Map<string, number>;
  private inverseVocab: Map<number, string>;
  private config: TokenizerConfig;
  private trie: TrieNode;

  // Special token IDs (XLM-RoBERTa style)
  private clsId: number = 0;  // <s>
  private sepId: number = 2;  // </s>
  private padId: number = 1;  // <pad>
  private unkId: number = 3;  // <unk>
  
  // Special token strings
  private clsToken: string = '<s>';
  private sepToken: string = '</s>';
  private padToken: string = '<pad>';
  private unkToken: string = '<unk>';

  constructor(vocab: Map<string, number>, config: Partial<TokenizerConfig> = {}) {
    this.vocab = vocab;
    this.config = { ...DEFAULT_TOKENIZER_CONFIG, ...config };

    // Build inverse vocab
    this.inverseVocab = new Map();
    for (const [token, id] of vocab) {
      this.inverseVocab.set(id, token);
    }

    // Build trie for fast prefix matching
    this.trie = createTrieNode();
    for (const [token, id] of vocab) {
      // Skip special tokens in trie (we handle them explicitly)
      if (token.startsWith('<') || token.startsWith('[')) continue;
      this.insertIntoTrie(token, id);
    }

    // Try to detect special tokens from vocab
    this.detectSpecialTokens();
  }

  /**
   * Insert a token into the trie
   */
  private insertIntoTrie(token: string, id: number): void {
    let node = this.trie;
    for (const char of token) {
      if (!node.children.has(char)) {
        node.children.set(char, createTrieNode());
      }
      node = node.children.get(char)!;
    }
    node.tokenId = id;
    node.token = token;
  }

  /**
   * Detect special tokens from vocabulary
   */
  private detectSpecialTokens(): void {
    // XLM-RoBERTa style
    if (this.vocab.has('<s>')) {
      this.clsToken = '<s>';
      this.clsId = this.vocab.get('<s>') ?? 0;
      this.sepToken = '</s>';
      this.sepId = this.vocab.get('</s>') ?? 2;
      this.padToken = '<pad>';
      this.padId = this.vocab.get('<pad>') ?? 1;
      this.unkToken = '<unk>';
      this.unkId = this.vocab.get('<unk>') ?? 3;
    }
    // BERT style
    else if (this.vocab.has('[CLS]')) {
      this.clsToken = '[CLS]';
      this.clsId = this.vocab.get('[CLS]') ?? 101;
      this.sepToken = '[SEP]';
      this.sepId = this.vocab.get('[SEP]') ?? 102;
      this.padToken = '[PAD]';
      this.padId = this.vocab.get('[PAD]') ?? 0;
      this.unkToken = '[UNK]';
      this.unkId = this.vocab.get('[UNK]') ?? 100;
    }
  }

  /**
   * Tokenizes text into tokens with offset tracking.
   * Truncates to maxLength tokens — use tokenizeWindows() for inputs that
   * may exceed the model's sequence length.
   */
  tokenize(text: string): TokenizationResult {
    const content = this.tokenizeContent(text);

    // Truncate if necessary (maxLength includes CLS and SEP)
    const maxContent = this.config.maxLength - 2;
    const truncated =
      content.length > maxContent ? content.slice(0, maxContent) : content;

    return this.buildResult(truncated, text);
  }

  /**
   * Tokenizes text into overlapping model-sized windows covering the full
   * input, so no tokens are silently dropped for long texts.
   * Each window carries a core character range; together the cores tile the
   * input exactly. Callers should keep an entity only from the window whose
   * core contains the entity's start offset.
   */
  tokenizeWindows(
    text: string,
    overlap: number = DEFAULT_WINDOW_OVERLAP
  ): TokenizationWindow[] {
    const content = this.tokenizeContent(text);
    const windowSize = this.config.maxLength - 2;

    // Short input: single window, identical to tokenize()
    if (content.length <= windowSize) {
      return [
        {
          ...this.buildResult(content, text),
          coreCharStart: 0,
          coreCharEnd: text.length,
        },
      ];
    }

    // Clamp overlap so the stride stays positive
    const effectiveOverlap = Math.min(
      Math.max(overlap, 0),
      Math.floor(windowSize / 2)
    );
    const stride = windowSize - effectiveOverlap;

    // Window start indices; the last window is right-aligned so it always
    // ends exactly at the end of the token stream
    const starts: number[] = [];
    for (let s = 0; ; s += stride) {
      if (s + windowSize >= content.length) {
        starts.push(content.length - windowSize);
        break;
      }
      starts.push(s);
    }

    const windows: TokenizationWindow[] = [];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]!;
      const end = start + windowSize;

      // Core boundaries sit at the midpoint of each overlap region, so
      // consecutive cores meet exactly and every token start is owned by
      // precisely one window
      const coreTokenStart =
        i === 0 ? 0 : Math.floor((start + starts[i - 1]! + windowSize) / 2);
      const coreTokenEnd =
        i === starts.length - 1
          ? content.length
          : Math.floor((starts[i + 1]! + end) / 2);

      windows.push({
        ...this.buildResult(content.slice(start, end), text),
        coreCharStart: i === 0 ? 0 : content[coreTokenStart]!.start,
        coreCharEnd:
          coreTokenEnd >= content.length
            ? text.length
            : content[coreTokenEnd]!.start,
      });
    }

    return windows;
  }

  /**
   * Tokenizes text into content tokens (no special tokens, no truncation)
   * using greedy longest-match with character offset tracking
   */
  private tokenizeContent(text: string): Token[] {
    const tokens: Token[] = [];

    // Preprocess text
    const processedText = this.config.doLowerCase ? text.toLowerCase() : text;

    // Tokenize using greedy longest-match
    let pos = 0;
    while (pos < processedText.length) {
      // Skip whitespace
      if (/\s/.test(processedText[pos]!)) {
        pos++;
        continue;
      }

      // Find the longest matching token starting at this position
      const { token, id, length } = this.findBestToken(processedText, pos);

      const isFirstOfWord = pos === 0 || /\s/.test(processedText[pos - 1]!);

      tokens.push({
        id,
        token,
        start: pos,
        end: pos + length,
        isContinuation: !isFirstOfWord && !token.startsWith('▁'),
        isSpecial: false,
      });

      pos += length;
    }

    return tokens;
  }

  /**
   * Wraps content tokens with CLS/SEP and builds the model input arrays
   */
  private buildResult(contentTokens: Token[], text: string): TokenizationResult {
    const tokens: Token[] = [
      {
        id: this.clsId,
        token: this.clsToken,
        start: 0,
        end: 0,
        isContinuation: false,
        isSpecial: true,
      },
      ...contentTokens,
      {
        id: this.sepId,
        token: this.sepToken,
        start: text.length,
        end: text.length,
        isContinuation: false,
        isSpecial: true,
      },
    ];

    const tokenToCharSpan: Array<[number, number] | null> = [
      null,
      ...contentTokens.map((t): [number, number] => [t.start, t.end]),
      null,
    ];

    return {
      tokens,
      inputIds: tokens.map((t) => t.id),
      attentionMask: tokens.map(() => 1),
      tokenTypeIds: tokens.map(() => 0),
      tokenToCharSpan,
    };
  }

  /**
   * Find the best matching token using trie-based greedy longest-match
   * O(max_token_length) instead of O(vocab_size)
   */
  private findBestToken(text: string, startPos: number): { token: string; id: number; length: number } {
    // Check if this starts a new word (preceded by space or start)
    const isWordStart = startPos === 0 || /\s/.test(text[startPos - 1]!);
    
    // For SentencePiece models, word-initial tokens start with ▁
    // Try matching with ▁ prefix first for word starts
    if (isWordStart) {
      const result = this.findLongestTrieMatch('▁', text, startPos);
      if (result) {
        return result;
      }
    }
    
    // Try matching without prefix
    const result = this.findLongestTrieMatch('', text, startPos);
    if (result) {
      return result;
    }
    
    // Single character fallback
    const char = text[startPos]!;
    const charId = this.vocab.get(char) ?? this.vocab.get('▁' + char) ?? this.unkId;
    return { token: char, id: charId, length: 1 };
  }

  /**
   * Find the longest matching token in the trie
   */
  private findLongestTrieMatch(
    prefix: string, 
    text: string, 
    startPos: number
  ): { token: string; id: number; length: number } | null {
    let node = this.trie;
    let bestMatch: { token: string; id: number; length: number } | null = null;
    
    // First, traverse the prefix (e.g., '▁')
    for (const char of prefix) {
      const child = node.children.get(char);
      if (!child) return null;
      node = child;
    }
    
    // Now traverse the actual text
    let matchLength = 0;
    for (let i = startPos; i < text.length; i++) {
      const char = text[i]!;
      const child = node.children.get(char);
      if (!child) break;
      
      node = child;
      matchLength++;
      
      // If this node represents a complete token, record it as best match so far
      if (node.tokenId !== null && node.token !== null) {
        bestMatch = {
          token: node.token,
          id: node.tokenId,
          length: matchLength, // Length in original text (without prefix)
        };
      }
    }
    
    return bestMatch;
  }

  /**
   * Decodes token IDs back to text
   */
  decode(tokenIds: number[]): string {
    const parts: string[] = [];

    for (const id of tokenIds) {
      const token = this.inverseVocab.get(id);
      if (token === undefined) continue;
      if (token === this.clsToken || token === this.sepToken || token === this.padToken) continue;
      
      // SentencePiece uses ▁ to mark word boundaries
      if (token.startsWith('▁')) {
        parts.push(' ' + token.slice(1));
      } else {
        parts.push(token);
      }
    }

    return parts.join('').trim();
  }

  /**
   * Gets vocabulary size
   */
  get vocabSize(): number {
    return this.vocab.size;
  }

  /**
   * Gets a token ID by string
   */
  getTokenId(token: string): number | undefined {
    return this.vocab.get(token);
  }

  /**
   * Gets a token string by ID
   */
  getToken(id: number): string | undefined {
    return this.inverseVocab.get(id);
  }
}

/**
 * Loads vocabulary from a file (supports tokenizer.json and vocab.txt)
 * Uses storage abstraction for browser compatibility
 */
export async function loadVocabFromFile(filePath: string): Promise<Map<string, number>> {
  const { getStorageProvider } = await import('#storage');
  const storage = await getStorageProvider();
  const content = await storage.readTextFile(filePath);
  
  // Detect format
  if (filePath.endsWith('.json') || content.trim().startsWith('{')) {
    return parseHFTokenizerJson(content);
  } else {
    return parseVocab(content);
  }
}

/**
 * Parses HuggingFace tokenizer.json format
 */
export function parseHFTokenizerJson(content: string): Map<string, number> {
  const vocab = new Map<string, number>();
  
  try {
    const config = JSON.parse(content) as HFTokenizerConfig;
    
    // Add special tokens first
    if (Array.isArray(config.added_tokens)) {
      for (const token of config.added_tokens) {
        vocab.set(token.content, token.id);
      }
    }
    
    // Add model vocabulary
    if (config.model !== undefined && config.model.vocab !== undefined) {
      if (Array.isArray(config.model.vocab)) {
        // Unigram format: array of [token, score] pairs
        for (let i = 0; i < config.model.vocab.length; i++) {
          const entry = config.model.vocab[i];
          if (entry && typeof entry[0] === 'string') {
            vocab.set(entry[0], i);
          }
        }
      } else {
        // BPE/WordPiece format: object mapping token -> id
        for (const [token, id] of Object.entries(config.model.vocab)) {
          vocab.set(token, id);
        }
      }
    }
  } catch (e) {
    throw new Error(`Failed to parse tokenizer.json: ${String(e)}`);
  }
  
  return vocab;
}

/**
 * Parses vocabulary from string content (vocab.txt format)
 */
export function parseVocab(content: string): Map<string, number> {
  const vocab = new Map<string, number>();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const token = lines[i]?.trim();
    if (token !== undefined && token.length > 0) {
      vocab.set(token, i);
    }
  }

  return vocab;
}

/**
 * Creates a minimal vocabulary for testing
 */
export function createTestVocab(): Map<string, number> {
  const tokens = [
    '<s>',
    '<pad>',
    '</s>',
    '<unk>',
    '▁Hello',
    '▁John',
    '▁Smith',
    '▁from',
    '▁Acme',
    '▁Corp',
    '▁in',
    '▁Berlin',
    '!',
  ];

  const vocab = new Map<string, number>();
  tokens.forEach((token, index) => {
    vocab.set(token, index);
  });

  return vocab;
}
