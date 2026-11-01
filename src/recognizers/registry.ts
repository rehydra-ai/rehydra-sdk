/**
 * Recognizer Registry
 * Central registry for all PII recognizers
 */

import { PIIType, SpanMatch, AnonymizationPolicy } from '../types/index.js';
import type { Recognizer } from './base.js';
import { createCustomIdRecognizer } from './custom-id.js';

const BUILT_IN_TYPES = new Set<string>(Object.values(PIIType));

/**
 * Whether regex detection is on for a type. Custom types outside PIIType
 * (issue #68) are never in the default regexEnabledTypes, so they only
 * need to be in enabledTypes.
 */
function isRegexEnabled(type: PIIType, policy: AnonymizationPolicy): boolean {
  if (!policy.enabledTypes.has(type)) return false;
  return !BUILT_IN_TYPES.has(type) || policy.regexEnabledTypes.has(type);
}

/** Whether a match's own type is enabled and it passes the type's confidence threshold. */
function isRegexMatchEnabled(match: SpanMatch, policy: AnonymizationPolicy): boolean {
  if (!isRegexEnabled(match.type, policy)) return false;
  return match.confidence >= (policy.confidenceThresholds.get(match.type) ?? 0.5);
}

/**
 * Registry for managing PII recognizers
 */
export class RecognizerRegistry {
  private recognizers: Map<PIIType, Recognizer[]> = new Map();

  /**
   * Registers a recognizer for a PII type
   */
  register(recognizer: Recognizer): void {
    const existing = this.recognizers.get(recognizer.type) ?? [];
    existing.push(recognizer);
    this.recognizers.set(recognizer.type, existing);
  }

  /**
   * Registers multiple recognizers
   */
  registerAll(recognizers: Recognizer[]): void {
    for (const recognizer of recognizers) {
      this.register(recognizer);
    }
  }

  /**
   * Gets all recognizers for a specific type
   */
  getRecognizers(type: PIIType): Recognizer[] {
    return this.recognizers.get(type) ?? [];
  }

  /**
   * Gets all registered recognizers
   */
  getAllRecognizers(): Recognizer[] {
    const all: Recognizer[] = [];
    for (const recognizers of this.recognizers.values()) {
      all.push(...recognizers);
    }
    return all;
  }

  /**
   * Gets all registered PII types
   */
  getRegisteredTypes(): PIIType[] {
    return Array.from(this.recognizers.keys());
  }

  /**
   * Checks if a recognizer is registered for a type
   */
  hasRecognizer(type: PIIType): boolean {
    const recognizers = this.recognizers.get(type);
    return recognizers !== undefined && recognizers.length > 0;
  }

  /**
   * Removes all recognizers for a type
   */
  unregister(type: PIIType): void {
    this.recognizers.delete(type);
  }

  /**
   * Removes one recognizer, keeping the others registered for its type
   */
  remove(recognizer: Recognizer): void {
    const remaining = (this.recognizers.get(recognizer.type) ?? []).filter(
      (item) => item !== recognizer
    );
    if (remaining.length > 0) {
      this.recognizers.set(recognizer.type, remaining);
    } else {
      this.recognizers.delete(recognizer.type);
    }
  }

  /**
   * Clears all recognizers
   */
  clear(): void {
    this.recognizers.clear();
  }

  /**
   * Runs all enabled recognizers on text and returns matches
   * @param text - Text to analyze
   * @param policy - Anonymization policy to determine which types to detect
   */
  findAll(text: string, policy: AnonymizationPolicy): SpanMatch[] {
    const matches: SpanMatch[] = [];

    for (const [type, recognizers] of this.recognizers) {
      // Skip types not enabled in policy
      if (!isRegexEnabled(type, policy)) {
        continue;
      }

      // Check each match's own type too: a recognizer can emit types other
      // than the one it is registered under (createCustomIdRecognizer).
      for (const recognizer of recognizers) {
        for (const match of recognizer.find(text)) {
          if (isRegexMatchEnabled(match, policy)) matches.push(match);
        }
      }
    }

    // Patterns from the policy run per call, under the same rules.
    const customIdPatterns = policy.customIdPatterns ?? [];
    if (customIdPatterns.length > 0) {
      for (const match of createCustomIdRecognizer(customIdPatterns).find(text)) {
        if (isRegexMatchEnabled(match, policy)) matches.push(match);
      }
    }

    return matches;
  }
}

/**
 * Global singleton registry instance
 */
let globalRegistry: RecognizerRegistry | null = null;

/**
 * Gets the global recognizer registry (singleton)
 */
export function getGlobalRegistry(): RecognizerRegistry {
  if (globalRegistry === null) {
    globalRegistry = new RecognizerRegistry();
  }
  return globalRegistry;
}

/**
 * Creates a new isolated registry (useful for testing)
 */
export function createRegistry(): RecognizerRegistry {
  return new RecognizerRegistry();
}

