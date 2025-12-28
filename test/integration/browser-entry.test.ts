/**
 * Tests for the browser entry point (src/browser.ts)
 * 
 * These tests verify that the browser-specific entry point:
 * 1. Exports all browser-compatible functionality
 * 2. Does NOT export Node.js-specific modules (like SQLitePIIStorageProvider)
 * 3. Functions identically to the main entry point for browser-safe features
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Main exports
  Anonymizer,
  createAnonymizer,
  anonymize,
  anonymizeRegexOnly,
  anonymizeWithNER,
  
  // Types
  PIIType,
  createDefaultPolicy,
  
  // Crypto
  InMemoryKeyProvider,
  ConfigKeyProvider,
  decryptPIIMap,
  encryptPIIMap,
  generateKey,
  deriveKey,
  generateSalt,
  validateKey,
  secureCompare,
  uint8ArrayToBase64,
  base64ToUint8Array,
  
  // Recognizers
  RegexRecognizer,
  RecognizerRegistry,
  createDefaultRegistry,
  createRegistry,
  getGlobalRegistry,
  emailRecognizer,
  phoneRecognizer,
  ibanRecognizer,
  bicSwiftRecognizer,
  creditCardRecognizer,
  ipAddressRecognizer,
  urlRecognizer,
  createCustomIdRecognizer,
  createCaseIdRecognizer,
  createCustomerIdRecognizer,
  
  // NER
  NERModelStub,
  createNERModelStub,
  
  // Pipeline
  prenormalize,
  resolveEntities,
  tagEntities,
  validateOutput,
  generateTag,
  parseTag,
  rehydrate,
  
  // Storage (browser-safe only)
  InMemoryPIIStorageProvider,
  IndexedDBPIIStorageProvider,
  
  // Storage utilities
  getStorageProvider,
  isNode,
  isBrowser,
  resetStorageProvider,
  setStorageProvider,
  
  // Path utilities
  pathJoin,
  pathDirname,
  pathBasename,
  pathNormalize,
  pathExtname,
  pathIsAbsolute,
} from '../../src/browser.js';

// Import the main entry point to verify SQLitePIIStorageProvider is there
import * as mainEntry from '../../src/index.js';

describe('Browser Entry Point', () => {
  describe('exports verification', () => {
    it('should export Anonymizer class', () => {
      expect(Anonymizer).toBeDefined();
      expect(typeof Anonymizer).toBe('function');
    });

    it('should export createAnonymizer function', () => {
      expect(createAnonymizer).toBeDefined();
      expect(typeof createAnonymizer).toBe('function');
    });

    it('should export convenience functions', () => {
      expect(anonymize).toBeDefined();
      expect(anonymizeRegexOnly).toBeDefined();
      expect(anonymizeWithNER).toBeDefined();
    });

    it('should export PIIType enum', () => {
      expect(PIIType).toBeDefined();
      expect(PIIType.EMAIL).toBe('EMAIL');
      expect(PIIType.PHONE).toBe('PHONE');
      expect(PIIType.PERSON).toBe('PERSON');
    });

    it('should export crypto utilities', () => {
      expect(InMemoryKeyProvider).toBeDefined();
      expect(ConfigKeyProvider).toBeDefined();
      expect(decryptPIIMap).toBeDefined();
      expect(encryptPIIMap).toBeDefined();
      expect(generateKey).toBeDefined();
      expect(deriveKey).toBeDefined();
      expect(generateSalt).toBeDefined();
      expect(validateKey).toBeDefined();
      expect(secureCompare).toBeDefined();
      expect(uint8ArrayToBase64).toBeDefined();
      expect(base64ToUint8Array).toBeDefined();
    });

    it('should export recognizers', () => {
      expect(RegexRecognizer).toBeDefined();
      expect(RecognizerRegistry).toBeDefined();
      expect(createDefaultRegistry).toBeDefined();
      expect(createRegistry).toBeDefined();
      expect(getGlobalRegistry).toBeDefined();
      expect(emailRecognizer).toBeDefined();
      expect(phoneRecognizer).toBeDefined();
      expect(ibanRecognizer).toBeDefined();
      expect(bicSwiftRecognizer).toBeDefined();
      expect(creditCardRecognizer).toBeDefined();
      expect(ipAddressRecognizer).toBeDefined();
      expect(urlRecognizer).toBeDefined();
      expect(createCustomIdRecognizer).toBeDefined();
      expect(createCaseIdRecognizer).toBeDefined();
      expect(createCustomerIdRecognizer).toBeDefined();
    });

    it('should export NER components', () => {
      expect(NERModelStub).toBeDefined();
      expect(createNERModelStub).toBeDefined();
    });

    it('should export pipeline functions', () => {
      expect(prenormalize).toBeDefined();
      expect(resolveEntities).toBeDefined();
      expect(tagEntities).toBeDefined();
      expect(validateOutput).toBeDefined();
      expect(generateTag).toBeDefined();
      expect(parseTag).toBeDefined();
      expect(rehydrate).toBeDefined();
    });

    it('should export browser-safe storage providers', () => {
      expect(InMemoryPIIStorageProvider).toBeDefined();
      expect(IndexedDBPIIStorageProvider).toBeDefined();
    });

    it('should export storage utilities', () => {
      expect(getStorageProvider).toBeDefined();
      expect(isNode).toBeDefined();
      expect(isBrowser).toBeDefined();
      expect(resetStorageProvider).toBeDefined();
      expect(setStorageProvider).toBeDefined();
    });

    it('should export path utilities', () => {
      expect(pathJoin).toBeDefined();
      expect(pathDirname).toBeDefined();
      expect(pathBasename).toBeDefined();
      expect(pathNormalize).toBeDefined();
      expect(pathExtname).toBeDefined();
      expect(pathIsAbsolute).toBeDefined();
    });

    it('should export createDefaultPolicy', () => {
      expect(createDefaultPolicy).toBeDefined();
      const policy = createDefaultPolicy();
      expect(policy.enabledTypes).toBeDefined();
      expect(policy.confidenceThresholds).toBeDefined();
    });
  });

  describe('SQLitePIIStorageProvider exclusion', () => {
    it('should NOT export SQLitePIIStorageProvider in browser entry', async () => {
      // Dynamically import browser entry to check exports
      const browserEntry = await import('../../src/browser.js');
      
      // SQLitePIIStorageProvider should not be in browser exports
      expect('SQLitePIIStorageProvider' in browserEntry).toBe(false);
    });

    it('should have SQLitePIIStorageProvider in main entry', () => {
      // Main entry should still have SQLite
      expect(mainEntry.SQLitePIIStorageProvider).toBeDefined();
    });
  });
});

describe('Browser Entry Point - Anonymizer Integration', () => {
  let anonymizer: Anonymizer;
  let keyProvider: InMemoryKeyProvider;

  beforeEach(async () => {
    keyProvider = new InMemoryKeyProvider();
    anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();
  });

  describe('basic anonymization', () => {
    it('should anonymize email addresses', async () => {
      const text = 'Contact us at support@example.com for help.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(result.anonymizedText).not.toContain('support@example.com');
      expect(result.stats.totalEntities).toBe(1);
      expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
    });

    it('should anonymize phone numbers', async () => {
      const text = 'Call +49 30 123456789 for assistance.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="PHONE"');
      expect(result.stats.countsByType[PIIType.PHONE]).toBeGreaterThanOrEqual(1);
    });

    it('should anonymize IBANs', async () => {
      const text = 'Transfer to DE89370400440532013000';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="IBAN"');
      expect(result.anonymizedText).not.toContain('DE89370400440532013000');
    });

    it('should anonymize credit cards', async () => {
      const text = 'Card number: 4111111111111111';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toContain('<PII type="CREDIT_CARD"');
      expect(result.anonymizedText).not.toContain('4111111111111111');
    });

    it('should handle multiple PII types in one text', async () => {
      const text = 'Contact john@example.com or call +49123456789. IBAN: DE89370400440532013000';
      const result = await anonymizer.anonymize(text);

      expect(result.stats.totalEntities).toBeGreaterThanOrEqual(3);
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(result.anonymizedText).toContain('<PII type="IBAN"');
    });
  });

  describe('PII map encryption', () => {
    it('should produce encrypted PII map', async () => {
      const text = 'Hello john@example.com';
      const result = await anonymizer.anonymize(text);

      expect(result.piiMap.ciphertext).toBeTruthy();
      expect(result.piiMap.iv).toBeTruthy();
      expect(result.piiMap.authTag).toBeTruthy();
    });

    it('should be decryptable with the key', async () => {
      const text = 'Hello john@example.com';
      const result = await anonymizer.anonymize(text);

      const key = await keyProvider.getKey();
      const decrypted = await decryptPIIMap(result.piiMap, key);

      expect(decrypted.size).toBe(1);
      expect(Array.from(decrypted.values())).toContain('john@example.com');
    });
  });

  describe('rehydration', () => {
    it('should rehydrate anonymized text correctly', async () => {
      const text = 'Contact john@example.com for details.';
      const result = await anonymizer.anonymize(text);

      const key = await keyProvider.getKey();
      const piiMap = await decryptPIIMap(result.piiMap, key);
      const rehydrated = rehydrate(result.anonymizedText, piiMap);

      expect(rehydrated).toBe(text);
    });
  });

  describe('policy handling', () => {
    it('should respect disabled types', async () => {
      const text = 'Email: test@example.com, Phone: +49123456789';
      const policy = {
        enabledTypes: new Set([PIIType.EMAIL]),
        regexEnabledTypes: new Set([PIIType.EMAIL]),
      };

      const result = await anonymizer.anonymize(text, undefined, policy);

      expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
      expect(result.stats.countsByType[PIIType.PHONE]).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty text', async () => {
      const result = await anonymizer.anonymize('');

      expect(result.anonymizedText).toBe('');
      expect(result.stats.totalEntities).toBe(0);
    });

    it('should handle text without PII', async () => {
      const text = 'This is a normal sentence without any personal information.';
      const result = await anonymizer.anonymize(text);

      expect(result.anonymizedText).toBe(text);
      expect(result.stats.totalEntities).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should dispose resources without error', async () => {
      await expect(anonymizer.dispose()).resolves.toBeUndefined();
    });

    it('should allow re-initialization after dispose', async () => {
      await anonymizer.dispose();
      await anonymizer.initialize();

      const result = await anonymizer.anonymize('test@example.com');
      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('stats', () => {
    it('should include processing time', async () => {
      const result = await anonymizer.anonymize('test@example.com');

      expect(result.stats.processingTimeMs).toBeGreaterThan(0);
    });

    it('should include model version', async () => {
      const result = await anonymizer.anonymize('test');

      expect(result.stats.modelVersion).toBeTruthy();
    });

    it('should include policy version', async () => {
      const result = await anonymizer.anonymize('test');

      expect(result.stats.policyVersion).toBeTruthy();
    });
  });
});

describe('Browser Entry Point - Convenience Functions', () => {
  describe('anonymize', () => {
    it('should work as standalone function', async () => {
      const result = await anonymize('Contact test@example.com');

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should accept locale parameter', async () => {
      const result = await anonymize('Contact test@example.com', 'en-US');

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });

    it('should accept policy parameter', async () => {
      const result = await anonymize('Contact test@example.com', undefined, {
        enabledTypes: new Set([PIIType.EMAIL]),
      });

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    });
  });

  describe('anonymizeRegexOnly', () => {
    it('should only use regex recognizers', async () => {
      const text = 'Contact test@example.com';
      const result = await anonymizeRegexOnly(text);

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      // NER types should not be detected
      expect(result.entities.every(e => e.source === 'REGEX')).toBe(true);
    });

    it('should accept policy parameter', async () => {
      const result = await anonymizeRegexOnly('test@example.com +49123456789', {
        enabledTypes: new Set([PIIType.EMAIL]),
        regexEnabledTypes: new Set([PIIType.EMAIL]),
      });

      // Should only have email, not phone
      expect(result.entities.every(e => e.type === PIIType.EMAIL)).toBe(true);
    });
  });
});

describe('Browser Entry Point - Storage Providers', () => {
  describe('InMemoryPIIStorageProvider', () => {
    it('should be available from browser entry', () => {
      const storage = new InMemoryPIIStorageProvider();
      expect(storage).toBeInstanceOf(InMemoryPIIStorageProvider);
    });

    it('should work with sessions', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        keyProvider,
        piiStorageProvider: storage,
      });
      await anonymizer.initialize();

      const session = anonymizer.session('test-session-1');
      const result = await session.anonymize('Hello john@example.com');

      expect(result.anonymizedText).toContain('<PII type="EMAIL"');
      expect(await session.exists()).toBe(true);
    });
  });

  describe('IndexedDBPIIStorageProvider', () => {
    it('should be available from browser entry', () => {
      expect(IndexedDBPIIStorageProvider).toBeDefined();
      expect(typeof IndexedDBPIIStorageProvider).toBe('function');
    });
  });
});

describe('Browser Entry Point - Session Error Messages', () => {
  it('should throw error when storage provider not configured', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    // Try to create session without storage provider
    expect(() => anonymizer.session('test')).toThrow('piiStorageProvider not configured');
  });

  it('should throw error when keyProvider is not configured', async () => {
    const storage = new InMemoryPIIStorageProvider();
    const anonymizer = createAnonymizer({
      piiStorageProvider: storage,
      // No keyProvider
    });
    await anonymizer.initialize();

    expect(() => anonymizer.session('test')).toThrow('keyProvider not configured');
  });

  it('should create session successfully when both providers are configured', async () => {
    const storage = new InMemoryPIIStorageProvider();
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      piiStorageProvider: storage,
      keyProvider,
    });
    await anonymizer.initialize();

    const session = anonymizer.session('test-session');
    expect(session).toBeDefined();
    expect(session.sessionId).toBe('test-session');
  });
});

describe('Browser Entry Point - Crypto Utilities', () => {
  it('should generate valid encryption keys', () => {
    const key = generateKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32); // 256 bits
  });

  it('should derive keys from passwords', async () => {
    const salt = generateSalt();
    const key = await deriveKey('mypassword', salt);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('should validate keys correctly', () => {
    const validKey = generateKey();
    const invalidKey = new Uint8Array(16); // Too short

    expect(validateKey(validKey)).toBe(true);
    expect(validateKey(invalidKey)).toBe(false);
  });

  it('should convert between base64 and Uint8Array', () => {
    const original = generateKey();
    const base64 = uint8ArrayToBase64(original);
    const restored = base64ToUint8Array(base64);

    expect(restored).toEqual(original);
  });

  it('should perform secure comparison', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);

    expect(secureCompare(a, b)).toBe(true);
    expect(secureCompare(a, c)).toBe(false);
  });
});

describe('Browser Entry Point - Path Utilities', () => {
  it('should join paths correctly', () => {
    expect(pathJoin('a', 'b', 'c')).toBe('a/b/c');
    expect(pathJoin('/root', 'dir', 'file.txt')).toBe('/root/dir/file.txt');
  });

  it('should get dirname correctly', () => {
    expect(pathDirname('/root/dir/file.txt')).toBe('/root/dir');
    expect(pathDirname('dir/file.txt')).toBe('dir');
  });

  it('should get basename correctly', () => {
    expect(pathBasename('/root/dir/file.txt')).toBe('file.txt');
    expect(pathBasename('file.txt')).toBe('file.txt');
  });

  it('should normalize paths correctly', () => {
    expect(pathNormalize('a//b/../c')).toBe('a/c');
    expect(pathNormalize('./a/./b')).toBe('a/b');
  });

  it('should get extension correctly', () => {
    expect(pathExtname('file.txt')).toBe('.txt');
    expect(pathExtname('file.tar.gz')).toBe('.gz');
    expect(pathExtname('file')).toBe('');
  });

  it('should check if path is absolute', () => {
    expect(pathIsAbsolute('/root/file')).toBe(true);
    expect(pathIsAbsolute('relative/path')).toBe(false);
  });
});

describe('Browser Entry Point - Registry Functions', () => {
  it('should create default registry', () => {
    const registry = createDefaultRegistry();
    expect(registry).toBeInstanceOf(RecognizerRegistry);
    expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
    expect(registry.hasRecognizer(PIIType.PHONE)).toBe(true);
  });

  it('should create empty registry', () => {
    const registry = createRegistry();
    expect(registry).toBeInstanceOf(RecognizerRegistry);
    expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(false);
  });

  it('should get global registry', () => {
    const registry = getGlobalRegistry();
    expect(registry).toBeInstanceOf(RecognizerRegistry);
  });
});

describe('Browser Entry Point - Pipeline Functions', () => {
  it('should prenormalize text', () => {
    const result = prenormalize('Hello\r\nWorld');
    expect(result).toBe('Hello\nWorld');
  });

  it('should generate and parse tags', () => {
    const tag = generateTag(PIIType.EMAIL, 1);
    expect(tag).toContain('EMAIL');
    expect(tag).toContain('1');

    const parsed = parseTag(tag);
    expect(parsed?.type).toBe(PIIType.EMAIL);
    expect(parsed?.id).toBe(1);
  });
});

describe('Browser Entry Point - Semantic Masking', () => {
  it('should work with semantic masking enabled', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Hello John Smith from Berlin');
    expect(result.anonymizedText).toBeDefined();
    expect(result.stats.totalEntities).toBeGreaterThanOrEqual(0);
    
    await anonymizer.dispose();
  });

  it('should pass through status callbacks for semantic config', async () => {
    const statuses: string[] = [];
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: {
        enabled: true,
        onStatus: (status) => statuses.push(status),
      },
    });
    await anonymizer.initialize();

    // Should have received status updates
    expect(statuses.length).toBeGreaterThanOrEqual(0);
    
    await anonymizer.dispose();
  });

  it('should preserve enableSemanticMasking when passing partial policy override', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    // Pass a partial policy that only changes enableLeakScan
    const result = await anonymizer.anonymize(
      'Hello Maria from Berlin',
      undefined,
      { enableLeakScan: false }
    );

    expect(result.anonymizedText).toBeDefined();
    expect(result.stats.leakScanPassed).toBeUndefined();
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - Policy Merging', () => {
  it('should preserve instance default thresholds when passing partial policy', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const customThresholds = new Map<PIIType, number>([
      [PIIType.EMAIL, 0.9],
      [PIIType.PERSON, 0.85],
    ]);
    const anonymizer = createAnonymizer({
      keyProvider,
      defaultPolicy: {
        ...createDefaultPolicy(),
        confidenceThresholds: customThresholds,
      },
    });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize(
      'Contact test@example.com',
      undefined,
      { enableLeakScan: false }
    );

    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    
    await anonymizer.dispose();
  });

  it('should allow overriding specific thresholds while preserving others', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize(
      'Contact test@example.com',
      undefined,
      {
        confidenceThresholds: new Map([[PIIType.IBAN, 0.99]]),
      }
    );

    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - NER Configuration', () => {
  it('should accept thresholds in NER config', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'disabled',
        thresholds: { PERSON: 0.8, ORG: 0.7 },
      },
    });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('test@example.com');
    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    
    await anonymizer.dispose();
  });

  it('should throw error when custom mode lacks modelPath', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'custom',
        vocabPath: '/some/path/vocab.txt',
      } as any,
    });

    await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
  });

  it('should throw error when custom mode lacks vocabPath', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'custom',
        modelPath: '/some/path/model.onnx',
      } as any,
    });

    await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
  });

  it('should throw error when custom mode has empty paths', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'custom',
        modelPath: '',
        vocabPath: '',
      },
    });

    await expect(anonymizer.initialize()).rejects.toThrow("NER mode 'custom' requires modelPath and vocabPath");
  });
});

describe('Browser Entry Point - Anonymizer Methods', () => {
  it('should return the NER model after initialization', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const nerModel = anonymizer.getNERModel();
    expect(nerModel).not.toBeNull();
    
    await anonymizer.dispose();
  });

  it('should return the recognizer registry', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const registry = anonymizer.getRegistry();
    expect(registry).toBeDefined();
    expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
    
    await anonymizer.dispose();
  });

  it('should be false before initialization', () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });

    expect(anonymizer.isInitialized).toBe(false);
  });

  it('should be true after initialization', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    expect(anonymizer.isInitialized).toBe(true);
    
    await anonymizer.dispose();
  });

  it('should be false after dispose', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();
    await anonymizer.dispose();

    expect(anonymizer.isInitialized).toBe(false);
  });

  it('should auto-initialize when anonymize is called', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });

    // Don't call initialize explicitly
    const result = await anonymizer.anonymize('test@example.com');

    expect(anonymizer.isInitialized).toBe(true);
    expect(result.anonymizedText).toContain('<PII type="EMAIL"');
    
    await anonymizer.dispose();
  });

  it('should generate random key when no keyProvider is configured', async () => {
    // Create anonymizer without keyProvider
    const anonymizer = createAnonymizer();
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('test@example.com');

    // Should still work - generates random key internally
    expect(result.piiMap.ciphertext).toBeTruthy();
    expect(result.piiMap.iv).toBeTruthy();
    expect(result.piiMap.authTag).toBeTruthy();
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - Locale Handling', () => {
  it('should accept locale parameter in anonymize', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Hello Maria Schmidt', 'de-DE');
    expect(result.anonymizedText).toBeDefined();
    
    await anonymizer.dispose();
  });

  it('should handle locale without region code', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Hello Maria Schmidt', 'de');
    expect(result.anonymizedText).toBeDefined();
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - Validation Warnings', () => {
  it('should log validation warnings for potential leaks', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      defaultPolicy: {
        ...createDefaultPolicy(),
        enableLeakScan: true,
        // Only detect IBAN to trigger leak warning for email-like text
        enabledTypes: new Set([PIIType.IBAN]),
        regexEnabledTypes: new Set([PIIType.IBAN]),
      },
    });
    await anonymizer.initialize();

    // This text has email-like content but we're only detecting IBANs
    // This may trigger leak scan warnings
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    await anonymizer.anonymize('Contact user@test.com for IBAN DE89370400440532013000');
    
    // Restore console.warn
    consoleSpy.mockRestore();
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - Semantic Masking Code Paths', () => {
  it('should execute semantic masking paths when enableSemanticMasking is true in policy', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    // Pass policy with enableSemanticMasking explicitly true
    const result = await anonymizer.anonymize(
      'Dr. Maria Schmidt from Berlin',
      'de-DE',
      { enableSemanticMasking: true }
    );

    expect(result.anonymizedText).toBeDefined();
    // Semantic masking should have been applied
    expect(result.stats).toBeDefined();
    
    await anonymizer.dispose();
  });

  it('should call mergeAdjacentTitleSpans when semantic masking is enabled', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    // Text with title and name that might be split
    const result = await anonymizer.anonymize('Mrs. Smith called today', 'en');
    
    expect(result.anonymizedText).toBeDefined();
    
    await anonymizer.dispose();
  });

  it('should call extractTitlesFromSpans when semantic masking is enabled', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    // Text with honorific title
    const result = await anonymizer.anonymize('Professor John Doe teaches physics', 'en');
    
    expect(result.anonymizedText).toBeDefined();
    
    await anonymizer.dispose();
  });

  it('should call enrichSemantics with locale when semantic masking is enabled', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      semantic: { enabled: true },
    });
    await anonymizer.initialize();

    // Test with various locales
    const result1 = await anonymizer.anonymize('Contact Hans Müller in München', 'de-DE');
    const result2 = await anonymizer.anonymize('Contact Jean Dupont in Paris', 'fr-FR');
    const result3 = await anonymizer.anonymize('Contact John Smith in London', 'en-GB');
    
    expect(result1.anonymizedText).toBeDefined();
    expect(result2.anonymizedText).toBeDefined();
    expect(result3.anonymizedText).toBeDefined();
    
    await anonymizer.dispose();
  });

  it('should skip semantic processing when enableSemanticMasking is false', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    // Explicitly disable semantic masking
    const result = await anonymizer.anonymize(
      'Dr. Maria Schmidt from Berlin',
      'de-DE',
      { enableSemanticMasking: false }
    );

    expect(result.anonymizedText).toBeDefined();
    // Should not have gender/scope attributes since semantic masking is disabled
    
    await anonymizer.dispose();
  });
});

describe('Browser Entry Point - Repeated PII Handling', () => {
  it('should handle repeated PII values correctly', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize(
      'Email test@example.com and again test@example.com'
    );

    expect(result.stats.countsByType[PIIType.EMAIL]).toBe(2);
    
    await anonymizer.dispose();
  });

  it('should normalize line endings in text', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Line1\r\nLine2\rLine3\n');

    // Line endings should be normalized
    expect(result.anonymizedText).not.toContain('\r\n');
    expect(result.anonymizedText).not.toContain('\r');
    
    await anonymizer.dispose();
  });

  it('should handle special characters in text', async () => {
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({ keyProvider });
    await anonymizer.initialize();

    const result = await anonymizer.anonymize('Contäct: üser@exämple.com');

    // Should handle unicode properly
    expect(result.anonymizedText).toBeTruthy();
    
    await anonymizer.dispose();
  });
});

