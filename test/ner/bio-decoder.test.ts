/**
 * BIO Decoder Tests
 * Tests the BIO tag parsing and entity span extraction
 */
import { describe, it, expect } from 'vitest';
import {
  parseBIOLabel,
  decodeBIOTags,
  convertToSpanMatches,
  cleanupSpanBoundaries,
  mergeAdjacentSpans,
  BIOTag,
  type RawNEREntity,
} from '../../src/ner/bio-decoder.js';
import { PIIType, DetectionSource, type SpanMatch } from '../../src/types/index.js';
import type { Token } from '../../src/ner/tokenizer.js';

describe('BIO Decoder', () => {
  describe('parseBIOLabel', () => {
    it('should parse B-PER label', () => {
      const result = parseBIOLabel('B-PER');
      expect(result.tag).toBe(BIOTag.B);
      expect(result.entityType).toBe('PER');
    });

    it('should parse I-PER label', () => {
      const result = parseBIOLabel('I-PER');
      expect(result.tag).toBe(BIOTag.I);
      expect(result.entityType).toBe('PER');
    });

    it('should parse B-ORG label', () => {
      const result = parseBIOLabel('B-ORG');
      expect(result.tag).toBe(BIOTag.B);
      expect(result.entityType).toBe('ORG');
    });

    it('should parse B-LOC label', () => {
      const result = parseBIOLabel('B-LOC');
      expect(result.tag).toBe(BIOTag.B);
      expect(result.entityType).toBe('LOC');
    });

    it('should parse O label', () => {
      const result = parseBIOLabel('O');
      expect(result.tag).toBe(BIOTag.O);
      expect(result.entityType).toBeNull();
    });

    it('should parse [PAD] as O', () => {
      const result = parseBIOLabel('[PAD]');
      expect(result.tag).toBe(BIOTag.O);
      expect(result.entityType).toBeNull();
    });

    it('should parse [CLS] as O', () => {
      const result = parseBIOLabel('[CLS]');
      expect(result.tag).toBe(BIOTag.O);
      expect(result.entityType).toBeNull();
    });

    it('should parse [SEP] as O', () => {
      const result = parseBIOLabel('[SEP]');
      expect(result.tag).toBe(BIOTag.O);
      expect(result.entityType).toBeNull();
    });

    it('should handle invalid labels', () => {
      const result = parseBIOLabel('INVALID');
      expect(result.tag).toBe(BIOTag.O);
      expect(result.entityType).toBeNull();
    });

    it('should handle lowercase B tag', () => {
      const result = parseBIOLabel('b-PER');
      expect(result.tag).toBe(BIOTag.B);
      expect(result.entityType).toBe('PER');
    });

    it('should handle lowercase I tag', () => {
      const result = parseBIOLabel('i-LOC');
      expect(result.tag).toBe(BIOTag.I);
      expect(result.entityType).toBe('LOC');
    });
  });

  describe('decodeBIOTags', () => {
    const createToken = (
      id: number,
      token: string,
      start: number,
      end: number,
      isSpecial = false
    ): Token => ({
      id,
      token,
      start,
      end,
      isContinuation: token.startsWith('##'),
      isSpecial,
    });

    it('should decode single entity', () => {
      const text = 'Hello John';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'John', 6, 10),
      ];
      const labels = ['O', 'B-PER'];
      const confidences = [0.99, 0.95];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      expect(entities[0]).toEqual({
        type: 'PER',
        start: 6,
        end: 10,
        confidence: 0.95,
        text: 'John',
        tokenIndices: [1],
      });
    });

    it('should decode multi-token entity', () => {
      const text = 'Hello John Smith';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'John', 6, 10),
        createToken(2, 'Smith', 11, 16),
      ];
      const labels = ['O', 'B-PER', 'I-PER'];
      const confidences = [0.99, 0.95, 0.93];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      expect(entities[0]!.type).toBe('PER');
      expect(entities[0]!.start).toBe(6);
      expect(entities[0]!.end).toBe(16);
      expect(entities[0]!.text).toBe('John Smith');
      expect(entities[0]!.tokenIndices).toEqual([1, 2]);
    });

    it('should decode multiple entities', () => {
      const text = 'John works at Apple';
      const tokens = [
        createToken(0, 'John', 0, 4),
        createToken(1, 'works', 5, 10),
        createToken(2, 'at', 11, 13),
        createToken(3, 'Apple', 14, 19),
      ];
      const labels = ['B-PER', 'O', 'O', 'B-ORG'];
      const confidences = [0.95, 0.99, 0.99, 0.92];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(2);
      expect(entities[0]!.type).toBe('PER');
      expect(entities[0]!.text).toBe('John');
      expect(entities[1]!.type).toBe('ORG');
      expect(entities[1]!.text).toBe('Apple');
    });

    it('should skip special tokens', () => {
      const text = 'Hello John';
      const tokens = [
        createToken(0, '[CLS]', 0, 0, true),
        createToken(1, 'Hello', 0, 5),
        createToken(2, 'John', 6, 10),
        createToken(3, '[SEP]', 10, 10, true),
      ];
      const labels = ['O', 'O', 'B-PER', 'O'];
      const confidences = [1.0, 0.99, 0.95, 1.0];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      expect(entities[0]!.text).toBe('John');
    });

    it('should handle I tag without B tag', () => {
      const text = 'Hello John';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'John', 6, 10),
      ];
      const labels = ['O', 'I-PER']; // I without B
      const confidences = [0.99, 0.95];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      expect(entities[0]!.type).toBe('PER');
      expect(entities[0]!.text).toBe('John');
    });

    it('should handle consecutive B tags of same type', () => {
      const text = 'John Mary';
      const tokens = [
        createToken(0, 'John', 0, 4),
        createToken(1, 'Mary', 5, 9),
      ];
      const labels = ['B-PER', 'B-PER']; // Two separate persons
      const confidences = [0.95, 0.93];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(2);
      expect(entities[0]!.text).toBe('John');
      expect(entities[1]!.text).toBe('Mary');
    });

    it('should close entity at type change', () => {
      const text = 'John Berlin';
      const tokens = [
        createToken(0, 'John', 0, 4),
        createToken(1, 'Berlin', 5, 11),
      ];
      const labels = ['B-PER', 'I-LOC']; // Type change
      const confidences = [0.95, 0.93];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(2);
      expect(entities[0]!.type).toBe('PER');
      expect(entities[1]!.type).toBe('LOC');
    });

    it('should handle entity at end of sequence', () => {
      const text = 'Hello John';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'John', 6, 10),
      ];
      const labels = ['O', 'B-PER'];
      const confidences = [0.99, 0.95];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      expect(entities[0]!.text).toBe('John');
    });

    it('should calculate average confidence for multi-token entities', () => {
      const text = 'Hello John Smith';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'John', 6, 10),
        createToken(2, 'Smith', 11, 16),
      ];
      const labels = ['O', 'B-PER', 'I-PER'];
      const confidences = [0.99, 0.90, 0.80];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(1);
      // Average of 0.90 and 0.80 = 0.85
      expect(entities[0]!.confidence).toBeCloseTo(0.85);
    });

    it('should handle empty token list', () => {
      const entities = decodeBIOTags([], [], [], '');
      expect(entities).toHaveLength(0);
    });

    it('should handle all O labels', () => {
      const text = 'Hello world';
      const tokens = [
        createToken(0, 'Hello', 0, 5),
        createToken(1, 'world', 6, 11),
      ];
      const labels = ['O', 'O'];
      const confidences = [0.99, 0.99];

      const entities = decodeBIOTags(tokens, labels, confidences, text);

      expect(entities).toHaveLength(0);
    });
  });

  describe('convertToSpanMatches', () => {
    it('should convert PER to PERSON', () => {
      const rawEntities: RawNEREntity[] = [
        {
          type: 'PER',
          start: 0,
          end: 4,
          confidence: 0.95,
          text: 'John',
          tokenIndices: [0],
        },
      ];

      const spans = convertToSpanMatches(rawEntities);

      expect(spans).toHaveLength(1);
      expect(spans[0]!.type).toBe(PIIType.PERSON);
      expect(spans[0]!.source).toBe(DetectionSource.NER);
    });

    it('should convert ORG correctly', () => {
      const rawEntities: RawNEREntity[] = [
        {
          type: 'ORG',
          start: 0,
          end: 5,
          confidence: 0.92,
          text: 'Apple',
          tokenIndices: [0],
        },
      ];

      const spans = convertToSpanMatches(rawEntities);

      expect(spans).toHaveLength(1);
      expect(spans[0]!.type).toBe(PIIType.ORG);
    });

    it('should convert LOC to LOCATION', () => {
      const rawEntities: RawNEREntity[] = [
        {
          type: 'LOC',
          start: 0,
          end: 6,
          confidence: 0.90,
          text: 'Berlin',
          tokenIndices: [0],
        },
      ];

      const spans = convertToSpanMatches(rawEntities);

      expect(spans).toHaveLength(1);
      expect(spans[0]!.type).toBe(PIIType.LOCATION);
    });

    it('should filter by confidence threshold', () => {
      const rawEntities: RawNEREntity[] = [
        { type: 'PER', start: 0, end: 4, confidence: 0.3, text: 'John', tokenIndices: [0] },
        { type: 'PER', start: 5, end: 9, confidence: 0.8, text: 'Mary', tokenIndices: [1] },
      ];

      const spans = convertToSpanMatches(rawEntities, 0.5);

      expect(spans).toHaveLength(1);
      expect(spans[0]!.text).toBe('Mary');
    });

    it('should skip unknown entity types', () => {
      const rawEntities: RawNEREntity[] = [
        { type: 'UNKNOWN_TYPE', start: 0, end: 4, confidence: 0.95, text: 'test', tokenIndices: [0] },
      ];

      const spans = convertToSpanMatches(rawEntities);

      expect(spans).toHaveLength(0);
    });
  });

  describe('cleanupSpanBoundaries', () => {
    it('should trim leading whitespace', () => {
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 5, confidence: 0.9, source: DetectionSource.NER, text: ' John' },
      ];

      const cleaned = cleanupSpanBoundaries(spans, ' John');

      expect(cleaned[0]!.start).toBe(1);
      expect(cleaned[0]!.text).toBe('John');
    });

    it('should trim trailing whitespace', () => {
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 5, confidence: 0.9, source: DetectionSource.NER, text: 'John ' },
      ];

      const cleaned = cleanupSpanBoundaries(spans, 'John ');

      expect(cleaned[0]!.end).toBe(4);
      expect(cleaned[0]!.text).toBe('John');
    });

    it('should trim punctuation from PERSON', () => {
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 6, confidence: 0.9, source: DetectionSource.NER, text: '"John"' },
      ];

      const cleaned = cleanupSpanBoundaries(spans, '"John"');

      expect(cleaned[0]!.start).toBe(1);
      expect(cleaned[0]!.end).toBe(5);
      expect(cleaned[0]!.text).toBe('John');
    });

    it('should not trim punctuation from non-PERSON types', () => {
      const spans: SpanMatch[] = [
        { type: PIIType.EMAIL, start: 0, end: 10, confidence: 0.9, source: DetectionSource.NER, text: '(a@b.com)' },
      ];

      // Only leading/trailing whitespace is trimmed for non-PERSON/ORG
      const cleaned = cleanupSpanBoundaries(spans, '(a@b.com)');

      // EMAIL type doesn't trim punctuation
      expect(cleaned[0]!.text).toBe('(a@b.com)');
    });

    it('should return original if span becomes empty', () => {
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 2, confidence: 0.9, source: DetectionSource.NER, text: '  ' },
      ];

      const cleaned = cleanupSpanBoundaries(spans, '  ');

      expect(cleaned[0]!.text).toBe('  '); // Original preserved
    });
  });

  describe('mergeAdjacentSpans', () => {
    it('should merge adjacent spans of same type', () => {
      const text = 'John Smith';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
        { type: PIIType.PERSON, start: 5, end: 10, confidence: 0.85, source: DetectionSource.NER, text: 'Smith' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.text).toBe('John Smith');
      expect(merged[0]!.confidence).toBe(0.875); // Average
    });

    it('should not shrink a span when merging a contained same-type span', () => {
      const text = 'John Smith Meyer here';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 16, confidence: 0.9, source: DetectionSource.NER, text: 'John Smith Meyer' },
        { type: PIIType.PERSON, start: 5, end: 10, confidence: 0.8, source: DetectionSource.NER, text: 'Smith' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.start).toBe(0);
      expect(merged[0]!.end).toBe(16);
      expect(merged[0]!.text).toBe('John Smith Meyer');
    });

    it('should not merge spans of different types', () => {
      const text = 'John Berlin';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
        { type: PIIType.LOCATION, start: 5, end: 11, confidence: 0.85, source: DetectionSource.NER, text: 'Berlin' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(2);
    });

    it('should not merge non-adjacent spans', () => {
      const text = 'John and Mary';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
        { type: PIIType.PERSON, start: 9, end: 13, confidence: 0.85, source: DetectionSource.NER, text: 'Mary' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(2);
    });

    it('should handle single span', () => {
      const text = 'John';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const merged = mergeAdjacentSpans([], '');
      expect(merged).toHaveLength(0);
    });

    it('should sort spans by position before merging', () => {
      const text = 'John Smith';
      const spans: SpanMatch[] = [
        { type: PIIType.PERSON, start: 5, end: 10, confidence: 0.85, source: DetectionSource.NER, text: 'Smith' },
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
      ];

      const merged = mergeAdjacentSpans(spans, text);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.text).toBe('John Smith');
    });
  });
});

