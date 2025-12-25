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
 * WordPiece Tokenizer - supports both HuggingFace JSON and vocab.txt formats
 */
export class WordPieceTokenizer {
  private vocab: Map<string, number>;
  private inverseVocab: Map<number, string>;
  private config: TokenizerConfig;
  private sortedVocab: Array<[string, number]>;

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

    // Sort vocab by token length (longest first) for greedy matching
    this.sortedVocab = Array.from(vocab.entries()).sort((a, b) => b[0].length - a[0].length);

    // Try to detect special tokens from vocab
    this.detectSpecialTokens();
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
   * Tokenizes text into tokens with offset tracking
   */
  tokenize(text: string): TokenizationResult {
    const tokens: Token[] = [];
    const tokenToCharSpan: Array<[number, number] | null> = [];

    // Add CLS token
    tokens.push({
      id: this.clsId,
      token: this.clsToken,
      start: 0,
      end: 0,
      isContinuation: false,
      isSpecial: true,
    });
    tokenToCharSpan.push(null);

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
      tokenToCharSpan.push([pos, pos + length]);
      
      pos += length;
    }

    // Add SEP token
    tokens.push({
      id: this.sepId,
      token: this.sepToken,
      start: text.length,
      end: text.length,
      isContinuation: false,
      isSpecial: true,
    });
    tokenToCharSpan.push(null);

    // Truncate if necessary
    const maxTokens = this.config.maxLength;
    if (tokens.length > maxTokens) {
      tokens.length = maxTokens - 1;
      tokenToCharSpan.length = maxTokens - 1;
      tokens.push({
        id: this.sepId,
        token: this.sepToken,
        start: text.length,
        end: text.length,
        isContinuation: false,
        isSpecial: true,
      });
      tokenToCharSpan.push(null);
    }

    // Build arrays
    const inputIds = tokens.map((t) => t.id);
    const attentionMask = tokens.map(() => 1);
    const tokenTypeIds = tokens.map(() => 0);

    return {
      tokens,
      inputIds,
      attentionMask,
      tokenTypeIds,
      tokenToCharSpan,
    };
  }

  /**
   * Find the best matching token using greedy longest-match
   */
  private findBestToken(text: string, startPos: number): { token: string; id: number; length: number } {
    const remaining = text.slice(startPos);
    
    // Check if this starts a new word (preceded by space or start)
    const isWordStart = startPos === 0 || /\s/.test(text[startPos - 1]!);
    
    // For SentencePiece models, word-initial tokens start with ▁
    if (isWordStart) {
      // Try with ▁ prefix first
      const withPrefix = '▁' + remaining;
      for (const [vocabToken, id] of this.sortedVocab) {
        if (withPrefix.startsWith(vocabToken)) {
          // Return the match length without the ▁ since that's not in original text
          return { 
            token: vocabToken, 
            id, 
            length: vocabToken.length - 1 // Subtract 1 for the ▁
          };
        }
      }
    }
    
    // Try exact match without prefix
    for (const [vocabToken, id] of this.sortedVocab) {
      // Skip special tokens and tokens starting with ▁ for non-word-start positions
      if (vocabToken.startsWith('<') || vocabToken.startsWith('[')) continue;
      if (!isWordStart && vocabToken.startsWith('▁')) continue;
      
      if (remaining.startsWith(vocabToken.replace(/^▁/, ''))) {
        const matchLength = vocabToken.replace(/^▁/, '').length;
        if (matchLength > 0) {
          return { token: vocabToken, id, length: matchLength };
        }
      }
    }
    
    // Single character fallback
    const char = remaining[0]!;
    const charId = this.vocab.get(char) ?? this.vocab.get('▁' + char) ?? this.unkId;
    return { token: char, id: charId, length: 1 };
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
  const { getStorageProvider } = await import('../utils/storage.js');
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
 * Loads vocabulary from content string (for when content is already available)
 */
export function loadVocabFromContent(content: string, format: 'json' | 'txt' = 'json'): Map<string, number> {
  if (format === 'json' || content.trim().startsWith('{')) {
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
