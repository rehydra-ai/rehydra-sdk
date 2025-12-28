/**
 * Tests for the browser-safe storage module (src/storage/browser.ts)
 * 
 * This module verifies that the browser storage exports are correct
 * and that SQLite is excluded.
 */
import { describe, it, expect } from 'vitest';
import {
  InMemoryPIIStorageProvider,
  IndexedDBPIIStorageProvider,
  AnonymizerSessionImpl,
} from '../../src/storage/browser.js';

// Import types to verify they're exported
import type {
  PIIStorageProvider,
  PIIMapMetadata,
  StoredPIIMap,
  ListOptions,
  AnonymizerSession,
  EncryptedPIIMap,
} from '../../src/storage/browser.js';

// Import main storage to compare
import * as mainStorage from '../../src/storage/index.js';

describe('Browser Storage Module', () => {
  describe('exports verification', () => {
    it('should export InMemoryPIIStorageProvider', () => {
      expect(InMemoryPIIStorageProvider).toBeDefined();
      expect(typeof InMemoryPIIStorageProvider).toBe('function');
    });

    it('should export IndexedDBPIIStorageProvider', () => {
      expect(IndexedDBPIIStorageProvider).toBeDefined();
      expect(typeof IndexedDBPIIStorageProvider).toBe('function');
    });

    it('should export AnonymizerSessionImpl', () => {
      expect(AnonymizerSessionImpl).toBeDefined();
      expect(typeof AnonymizerSessionImpl).toBe('function');
    });

    it('should NOT export SQLitePIIStorageProvider', async () => {
      const browserStorage = await import('../../src/storage/browser.js');
      expect('SQLitePIIStorageProvider' in browserStorage).toBe(false);
    });

    it('should have SQLitePIIStorageProvider in main storage module', () => {
      expect(mainStorage.SQLitePIIStorageProvider).toBeDefined();
    });
  });

  describe('InMemoryPIIStorageProvider functionality', () => {
    it('should create instance', () => {
      const storage = new InMemoryPIIStorageProvider();
      expect(storage).toBeInstanceOf(InMemoryPIIStorageProvider);
    });

    it('should save and load PII maps', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test-cipher',
        iv: 'test-iv',
        authTag: 'test-auth',
      };

      await storage.save('conv-1', testMap);
      const loaded = await storage.load('conv-1');

      expect(loaded).not.toBeNull();
      expect(loaded?.piiMap.ciphertext).toBe('test-cipher');
      expect(loaded?.piiMap.iv).toBe('test-iv');
      expect(loaded?.piiMap.authTag).toBe('test-auth');
    });

    it('should return null for non-existent conversation', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const loaded = await storage.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('should delete PII maps', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };

      await storage.save('conv-1', testMap);
      expect(await storage.exists('conv-1')).toBe(true);

      const deleted = await storage.delete('conv-1');
      expect(deleted).toBe(true);
      expect(await storage.exists('conv-1')).toBe(false);
    });

    it('should check existence', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };

      expect(await storage.exists('conv-1')).toBe(false);
      await storage.save('conv-1', testMap);
      expect(await storage.exists('conv-1')).toBe(true);
    });

    it('should list conversations', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };

      await storage.save('conv-1', testMap);
      await storage.save('conv-2', testMap);
      await storage.save('conv-3', testMap);

      const list = await storage.list();
      expect(list).toHaveLength(3);
      expect(list).toContain('conv-1');
      expect(list).toContain('conv-2');
      expect(list).toContain('conv-3');
    });

    it('should support list with limit', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };

      await storage.save('conv-1', testMap);
      await storage.save('conv-2', testMap);
      await storage.save('conv-3', testMap);

      const list = await storage.list({ limit: 2 });
      expect(list).toHaveLength(2);
    });

    it('should cleanup old entries', async () => {
      const storage = new InMemoryPIIStorageProvider();
      const testMap: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };

      // Save with old timestamp
      const oldTime = Date.now() - 10000;
      await storage.save('old-conv', testMap, { createdAt: oldTime });
      
      // Save with current timestamp
      await storage.save('new-conv', testMap);

      // Cleanup entries older than 5 seconds ago
      const cutoff = new Date(Date.now() - 5000);
      const cleaned = await storage.cleanup(cutoff);

      expect(cleaned).toBe(1);
      expect(await storage.exists('old-conv')).toBe(false);
      expect(await storage.exists('new-conv')).toBe(true);
    });
  });

  describe('IndexedDBPIIStorageProvider', () => {
    it('should be constructable', () => {
      // Just verify it can be constructed (actual IndexedDB tests are in indexeddb.test.ts)
      expect(() => new IndexedDBPIIStorageProvider()).not.toThrow();
    });

    it('should accept custom database name', () => {
      expect(() => new IndexedDBPIIStorageProvider('custom-db-name')).not.toThrow();
    });
  });

  describe('type exports', () => {
    it('should export PIIStorageProvider type', () => {
      // Type-only check - if this compiles, the type is exported
      const checkType = (provider: PIIStorageProvider): void => {
        expect(provider.save).toBeDefined();
        expect(provider.load).toBeDefined();
        expect(provider.delete).toBeDefined();
        expect(provider.exists).toBeDefined();
        expect(provider.list).toBeDefined();
        expect(provider.cleanup).toBeDefined();
      };
      
      checkType(new InMemoryPIIStorageProvider());
    });

    it('should export PIIMapMetadata type', () => {
      const metadata: PIIMapMetadata = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        entityCounts: { EMAIL: 1 },
        modelVersion: '1.0.0',
      };
      
      expect(metadata.createdAt).toBeDefined();
    });

    it('should export StoredPIIMap type', () => {
      const stored: StoredPIIMap = {
        piiMap: {
          ciphertext: 'test',
          iv: 'test',
          authTag: 'test',
        },
        metadata: {
          createdAt: Date.now(),
        },
      };
      
      expect(stored.piiMap).toBeDefined();
      expect(stored.metadata).toBeDefined();
    });

    it('should export ListOptions type', () => {
      const options: ListOptions = {
        limit: 10,
        olderThan: new Date(),
      };
      
      expect(options.limit).toBe(10);
    });

    it('should export EncryptedPIIMap type', () => {
      const encrypted: EncryptedPIIMap = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
      };
      
      expect(encrypted.ciphertext).toBeDefined();
    });
  });
});

