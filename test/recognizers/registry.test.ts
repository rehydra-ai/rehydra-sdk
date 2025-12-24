import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecognizerRegistry,
  getGlobalRegistry,
  createRegistry,
} from '../../src/recognizers/registry.js';
import { emailRecognizer } from '../../src/recognizers/email.js';
import { phoneRecognizer } from '../../src/recognizers/phone.js';
import { urlRecognizer } from '../../src/recognizers/url.js';
import { createRegexRecognizer } from '../../src/recognizers/base.js';
import { PIIType, createDefaultPolicy, type Recognizer } from '../../src/types/index.js';

describe('RecognizerRegistry', () => {
  let registry: RecognizerRegistry;

  beforeEach(() => {
    registry = new RecognizerRegistry();
  });

  describe('register', () => {
    it('should register a recognizer', () => {
      registry.register(emailRecognizer);

      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
      expect(registry.getRecognizers(PIIType.EMAIL)).toHaveLength(1);
    });

    it('should allow multiple recognizers for same type', () => {
      const customEmail = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom Email',
        patterns: [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
      });

      registry.register(emailRecognizer);
      registry.register(customEmail);

      expect(registry.getRecognizers(PIIType.EMAIL)).toHaveLength(2);
    });

    it('should register recognizers for different types', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);
      registry.register(urlRecognizer);

      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
      expect(registry.hasRecognizer(PIIType.PHONE)).toBe(true);
      expect(registry.hasRecognizer(PIIType.URL)).toBe(true);
    });
  });

  describe('registerAll', () => {
    it('should register multiple recognizers', () => {
      registry.registerAll([emailRecognizer, phoneRecognizer, urlRecognizer]);

      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
      expect(registry.hasRecognizer(PIIType.PHONE)).toBe(true);
      expect(registry.hasRecognizer(PIIType.URL)).toBe(true);
    });

    it('should handle empty array', () => {
      registry.registerAll([]);

      expect(registry.getAllRecognizers()).toHaveLength(0);
    });
  });

  describe('getRecognizers', () => {
    it('should return empty array for unregistered type', () => {
      expect(registry.getRecognizers(PIIType.EMAIL)).toEqual([]);
    });

    it('should return registered recognizers for type', () => {
      registry.register(emailRecognizer);

      const recognizers = registry.getRecognizers(PIIType.EMAIL);
      expect(recognizers).toHaveLength(1);
      expect(recognizers[0]).toBe(emailRecognizer);
    });

    it('should return all recognizers for type', () => {
      const custom1 = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom 1',
        patterns: [/test1/gi],
      });
      const custom2 = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom 2',
        patterns: [/test2/gi],
      });

      registry.register(emailRecognizer);
      registry.register(custom1);
      registry.register(custom2);

      expect(registry.getRecognizers(PIIType.EMAIL)).toHaveLength(3);
    });
  });

  describe('getAllRecognizers', () => {
    it('should return empty array when no recognizers registered', () => {
      expect(registry.getAllRecognizers()).toEqual([]);
    });

    it('should return all registered recognizers', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);
      registry.register(urlRecognizer);

      const all = registry.getAllRecognizers();
      expect(all.length).toBeGreaterThanOrEqual(3);
    });

    it('should include all recognizers for multiple types', () => {
      const custom1 = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom Email',
        patterns: [/test/gi],
      });
      const custom2 = createRegexRecognizer({
        type: PIIType.PHONE,
        name: 'Custom Phone',
        patterns: [/test/gi],
      });

      registry.register(emailRecognizer);
      registry.register(custom1);
      registry.register(phoneRecognizer);
      registry.register(custom2);

      const all = registry.getAllRecognizers();
      expect(all.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('getRegisteredTypes', () => {
    it('should return empty array when no recognizers registered', () => {
      expect(registry.getRegisteredTypes()).toEqual([]);
    });

    it('should return all registered types', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);
      registry.register(urlRecognizer);

      const types = registry.getRegisteredTypes();
      expect(types).toContain(PIIType.EMAIL);
      expect(types).toContain(PIIType.PHONE);
      expect(types).toContain(PIIType.URL);
    });

    it('should return unique types only', () => {
      const custom = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom',
        patterns: [/test/gi],
      });

      registry.register(emailRecognizer);
      registry.register(custom);

      const types = registry.getRegisteredTypes();
      expect(types.filter(t => t === PIIType.EMAIL)).toHaveLength(1);
    });
  });

  describe('hasRecognizer', () => {
    it('should return false for unregistered type', () => {
      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(false);
    });

    it('should return true for registered type', () => {
      registry.register(emailRecognizer);
      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(true);
    });

    it('should return false after unregistering', () => {
      registry.register(emailRecognizer);
      registry.unregister(PIIType.EMAIL);
      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should remove all recognizers for type', () => {
      registry.register(emailRecognizer);
      const custom = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom',
        patterns: [/test/gi],
      });
      registry.register(custom);

      registry.unregister(PIIType.EMAIL);

      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(false);
      expect(registry.getRecognizers(PIIType.EMAIL)).toHaveLength(0);
    });

    it('should not affect other types', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);

      registry.unregister(PIIType.EMAIL);

      expect(registry.hasRecognizer(PIIType.EMAIL)).toBe(false);
      expect(registry.hasRecognizer(PIIType.PHONE)).toBe(true);
    });

    it('should handle unregistering non-existent type', () => {
      expect(() => registry.unregister(PIIType.EMAIL)).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all recognizers', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);
      registry.register(urlRecognizer);

      registry.clear();

      expect(registry.getAllRecognizers()).toHaveLength(0);
      expect(registry.getRegisteredTypes()).toHaveLength(0);
    });

    it('should handle clearing empty registry', () => {
      expect(() => registry.clear()).not.toThrow();
    });
  });

  describe('findAll', () => {
    it('should find matches from all enabled recognizers', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);

      const policy = createDefaultPolicy();
      const text = 'Contact test@example.com or call +49123456789';
      const matches = registry.findAll(text, policy);

      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('should only find matches for enabled types', () => {
      registry.register(emailRecognizer);
      registry.register(phoneRecognizer);

      const policy = createDefaultPolicy();
      policy.enabledTypes = new Set([PIIType.EMAIL]);
      policy.regexEnabledTypes = new Set([PIIType.EMAIL]);

      const text = 'Email: test@example.com Phone: +49123456789';
      const matches = registry.findAll(text, policy);

      // Should only have email matches
      expect(matches.every(m => m.type === PIIType.EMAIL)).toBe(true);
    });

    it('should filter by confidence threshold', () => {
      registry.register(emailRecognizer);

      const policy = createDefaultPolicy();
      policy.confidenceThresholds.set(PIIType.EMAIL, 0.99); // Very high threshold

      const text = 'Email: test@example.com';
      const matches = registry.findAll(text, policy);

      // Email recognizer has 0.95 confidence, so should be filtered out
      expect(matches.length).toBe(0);
    });

    it('should include matches above threshold', () => {
      registry.register(emailRecognizer);

      const policy = createDefaultPolicy();
      policy.confidenceThresholds.set(PIIType.EMAIL, 0.9); // Lower threshold

      const text = 'Email: test@example.com';
      const matches = registry.findAll(text, policy);

      // Email recognizer has 0.95 confidence, so should be included
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should use default threshold when not specified', () => {
      registry.register(emailRecognizer);

      const policy = createDefaultPolicy();
      // Don't set custom threshold

      const text = 'Email: test@example.com';
      const matches = registry.findAll(text, policy);

      // Should use default threshold (0.5) and include matches
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty text', () => {
      registry.register(emailRecognizer);

      const policy = createDefaultPolicy();
      const matches = registry.findAll('', policy);

      expect(matches).toHaveLength(0);
    });

    it('should handle text with no matches', () => {
      registry.register(emailRecognizer);

      const policy = createDefaultPolicy();
      const matches = registry.findAll('No PII here', policy);

      expect(matches).toHaveLength(0);
    });

    it('should handle multiple recognizers for same type', () => {
      const customEmail = createRegexRecognizer({
        type: PIIType.EMAIL,
        name: 'Custom Email',
        patterns: [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
        defaultConfidence: 0.8,
      });

      registry.register(emailRecognizer);
      registry.register(customEmail);

      const policy = createDefaultPolicy();
      const text = 'Email: test@example.com';
      const matches = registry.findAll(text, policy);

      // Both recognizers might match
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('getGlobalRegistry', () => {
  it('should return a singleton instance', () => {
    const registry1 = getGlobalRegistry();
    const registry2 = getGlobalRegistry();

    expect(registry1).toBe(registry2);
  });

  it('should persist recognizers across calls', () => {
    const registry = getGlobalRegistry();
    registry.clear(); // Start fresh

    registry.register(emailRecognizer);

    const registry2 = getGlobalRegistry();
    expect(registry2.hasRecognizer(PIIType.EMAIL)).toBe(true);
  });
});

describe('createRegistry', () => {
  it('should create a new isolated registry', () => {
    const registry1 = createRegistry();
    const registry2 = createRegistry();

    expect(registry1).not.toBe(registry2);
  });

  it('should create empty registry', () => {
    const registry = createRegistry();

    expect(registry.getAllRecognizers()).toHaveLength(0);
  });

  it('should be independent from global registry', () => {
    const global = getGlobalRegistry();
    global.clear();
    global.register(emailRecognizer);

    const isolated = createRegistry();
    expect(isolated.hasRecognizer(PIIType.EMAIL)).toBe(false);
  });
});

