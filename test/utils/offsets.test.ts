import { describe, it, expect } from 'vitest';
import {
  spansOverlap,
  spanContains,
  spanLength,
  getSpanText,
  sortSpansByPosition,
  sortSpansByPositionDescending,
  removeOverlappingSpans,
  validateNoOverlaps,
  buildOffsetAdjustments,
  type OffsetAdjustment,
} from '../../src/utils/offsets.js';
import { PIIType, DetectionSource, type SpanMatch } from '../../src/types/index.js';

describe('spansOverlap', () => {
  it('should detect overlapping spans', () => {
    expect(spansOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
    expect(spansOverlap({ start: 5, end: 15 }, { start: 0, end: 10 })).toBe(true);
  });

  it('should detect when one span contains another', () => {
    expect(spansOverlap({ start: 0, end: 20 }, { start: 5, end: 15 })).toBe(true);
    expect(spansOverlap({ start: 5, end: 15 }, { start: 0, end: 20 })).toBe(true);
  });

  it('should detect adjacent spans (touching)', () => {
    expect(spansOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });

  it('should detect non-overlapping spans', () => {
    expect(spansOverlap({ start: 0, end: 10 }, { start: 15, end: 25 })).toBe(false);
    expect(spansOverlap({ start: 15, end: 25 }, { start: 0, end: 10 })).toBe(false);
  });

  it('should handle zero-length spans', () => {
    expect(spansOverlap({ start: 5, end: 5 }, { start: 5, end: 10 })).toBe(false);
    expect(spansOverlap({ start: 5, end: 10 }, { start: 5, end: 5 })).toBe(false);
  });
});

describe('spanContains', () => {
  it('should detect when outer contains inner', () => {
    expect(spanContains({ start: 0, end: 20 }, { start: 5, end: 15 })).toBe(true);
  });

  it('should detect when spans are equal', () => {
    expect(spanContains({ start: 5, end: 15 }, { start: 5, end: 15 })).toBe(true);
  });

  it('should detect when inner touches outer boundaries', () => {
    expect(spanContains({ start: 0, end: 20 }, { start: 0, end: 10 })).toBe(true);
    expect(spanContains({ start: 0, end: 20 }, { start: 10, end: 20 })).toBe(true);
  });

  it('should reject when inner extends beyond outer', () => {
    expect(spanContains({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(false);
    expect(spanContains({ start: 5, end: 15 }, { start: 0, end: 20 })).toBe(false);
  });

  it('should reject non-overlapping spans', () => {
    expect(spanContains({ start: 0, end: 10 }, { start: 15, end: 25 })).toBe(false);
  });
});

describe('spanLength', () => {
  it('should calculate span length', () => {
    expect(spanLength({ start: 0, end: 10 })).toBe(10);
    expect(spanLength({ start: 5, end: 15 })).toBe(10);
    expect(spanLength({ start: 100, end: 150 })).toBe(50);
  });

  it('should handle zero-length spans', () => {
    expect(spanLength({ start: 5, end: 5 })).toBe(0);
  });
});

describe('getSpanText', () => {
  it('should extract text for span', () => {
    const text = 'Hello World';
    expect(getSpanText(text, { start: 0, end: 5 })).toBe('Hello');
    expect(getSpanText(text, { start: 6, end: 11 })).toBe('World');
  });

  it('should handle full text span', () => {
    const text = 'Hello World';
    expect(getSpanText(text, { start: 0, end: text.length })).toBe(text);
  });

  it('should handle empty span', () => {
    const text = 'Hello World';
    expect(getSpanText(text, { start: 5, end: 5 })).toBe('');
  });
});

describe('sortSpansByPosition', () => {
  it('should sort spans by start position ascending', () => {
    const spans = [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ];

    const sorted = sortSpansByPosition(spans);
    expect(sorted[0]?.start).toBe(0);
    expect(sorted[1]?.start).toBe(10);
    expect(sorted[2]?.start).toBe(20);
  });

  it('should sort by length descending when start positions are equal', () => {
    const spans = [
      { start: 0, end: 5 },
      { start: 0, end: 10 },
      { start: 0, end: 15 },
    ];

    const sorted = sortSpansByPosition(spans);
    expect(sorted[0]?.end).toBe(15); // Longest first
    expect(sorted[1]?.end).toBe(10);
    expect(sorted[2]?.end).toBe(5);
  });

  it('should not mutate original array', () => {
    const spans = [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
    ];
    const original = [...spans];

    sortSpansByPosition(spans);
    expect(spans).toEqual(original);
  });

  it('should handle empty array', () => {
    expect(sortSpansByPosition([])).toEqual([]);
  });

  it('should handle single span', () => {
    const spans = [{ start: 5, end: 10 }];
    const sorted = sortSpansByPosition(spans);
    expect(sorted).toEqual(spans);
  });
});

describe('sortSpansByPositionDescending', () => {
  it('should sort spans by start position descending', () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 10, end: 20 },
    ];

    const sorted = sortSpansByPositionDescending(spans);
    expect(sorted[0]?.start).toBe(20);
    expect(sorted[1]?.start).toBe(10);
    expect(sorted[2]?.start).toBe(0);
  });

  it('should not mutate original array', () => {
    const spans = [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
    ];
    const original = [...spans];

    sortSpansByPositionDescending(spans);
    expect(spans).toEqual(original);
  });
});

describe('removeOverlappingSpans', () => {
  it('should remove overlapping spans based on preference', () => {
    const spans: SpanMatch[] = [
      {
        type: PIIType.EMAIL,
        start: 0,
        end: 10,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test@test',
      },
      {
        type: PIIType.EMAIL,
        start: 5,
        end: 15,
        confidence: 0.95, // Higher confidence
        source: DetectionSource.REGEX,
        text: 'test@test',
      },
    ];

    // Prefer higher confidence
    const result = removeOverlappingSpans(spans, (a, b) => a.confidence - b.confidence);

    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe(0.95);
  });

  it('should keep non-overlapping spans', () => {
    const spans: SpanMatch[] = [
      {
        type: PIIType.EMAIL,
        start: 0,
        end: 10,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test1@test',
      },
      {
        type: PIIType.EMAIL,
        start: 15,
        end: 25,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test2@test',
      },
    ];

    const result = removeOverlappingSpans(spans, () => 0);

    expect(result).toHaveLength(2);
  });

  it('should handle empty array', () => {
    const result = removeOverlappingSpans([], () => 0);
    expect(result).toEqual([]);
  });

  it('should handle single span', () => {
    const spans: SpanMatch[] = [
      {
        type: PIIType.EMAIL,
        start: 0,
        end: 10,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test@test',
      },
    ];

    const result = removeOverlappingSpans(spans, () => 0);
    expect(result).toHaveLength(1);
  });

  it('should prefer first span when preference is 0', () => {
    const spans: SpanMatch[] = [
      {
        type: PIIType.EMAIL,
        start: 0,
        end: 10,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test1@test',
      },
      {
        type: PIIType.EMAIL,
        start: 5,
        end: 15,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: 'test2@test',
      },
    ];

    const result = removeOverlappingSpans(spans, () => 0);
    // When preference is 0, existing span is preferred
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('test1@test');
  });
});

describe('validateNoOverlaps', () => {
  it('should return true for non-overlapping spans', () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 15, end: 25 },
      { start: 30, end: 40 },
    ];

    expect(validateNoOverlaps(spans)).toBe(true);
  });

  it('should return true for adjacent spans', () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ];

    expect(validateNoOverlaps(spans)).toBe(true);
  });

  it('should return false for overlapping spans', () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ];

    expect(validateNoOverlaps(spans)).toBe(false);
  });

  it('should return true for empty array', () => {
    expect(validateNoOverlaps([])).toBe(true);
  });

  it('should return true for single span', () => {
    expect(validateNoOverlaps([{ start: 0, end: 10 }])).toBe(true);
  });

  it('should handle unsorted spans', () => {
    const spans = [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
      { start: 5, end: 15 }, // Overlaps with second
    ];

    expect(validateNoOverlaps(spans)).toBe(false);
  });
});

describe('buildOffsetAdjustments', () => {
  it('should build adjustments for single replacement', () => {
    const replacements = [
      { start: 0, end: 5, replacement: 'Hello' },
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      originalStart: 0,
      originalEnd: 5,
      newStart: 0,
      newEnd: 5,
      delta: 0, // Same length
    });
  });

  it('should calculate delta for length changes', () => {
    const replacements = [
      { start: 0, end: 5, replacement: 'Hi' }, // Shorter
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    expect(adjustments[0]?.delta).toBe(-3); // 2 - 5 = -3
    expect(adjustments[0]?.newEnd).toBe(2);
  });

  it('should accumulate delta for multiple replacements', () => {
    const replacements = [
      { start: 0, end: 5, replacement: 'Hi' }, // -3 delta
      { start: 10, end: 15, replacement: 'Hello World' }, // +5 delta
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    expect(adjustments).toHaveLength(2);
    expect(adjustments[0]?.delta).toBe(-3);
    expect(adjustments[0]?.newStart).toBe(0);
    expect(adjustments[0]?.newEnd).toBe(2);

    // Second replacement adjusted by first delta
    expect(adjustments[1]?.delta).toBe(6); // 11 - 5 = 6 (Hello World is 11 chars, original was 5)
    expect(adjustments[1]?.newStart).toBe(7); // 10 - 3 = 7
    expect(adjustments[1]?.newEnd).toBe(18); // 7 + 11 = 18
  });

  it('should handle replacements in reverse order', () => {
    const replacements = [
      { start: 20, end: 25, replacement: 'A' },
      { start: 0, end: 5, replacement: 'B' },
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    // Should be sorted by position
    expect(adjustments[0]?.originalStart).toBe(0);
    expect(adjustments[1]?.originalStart).toBe(20);
  });

  it('should handle empty replacements array', () => {
    expect(buildOffsetAdjustments([])).toEqual([]);
  });

  it('should handle overlapping replacements', () => {
    const replacements = [
      { start: 0, end: 10, replacement: 'A' },
      { start: 5, end: 15, replacement: 'B' },
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    // Should still calculate, even if overlapping
    expect(adjustments).toHaveLength(2);
  });

  it('should calculate cumulative delta correctly', () => {
    const replacements = [
      { start: 0, end: 2, replacement: 'A' }, // -1 delta
      { start: 5, end: 7, replacement: 'BBB' }, // +1 delta (3-2)
      { start: 10, end: 12, replacement: 'C' }, // -1 delta (1-2)
    ];

    const adjustments = buildOffsetAdjustments(replacements);

    expect(adjustments[0]?.delta).toBe(-1);
    expect(adjustments[0]?.newStart).toBe(0);
    expect(adjustments[0]?.newEnd).toBe(1);

    // Second: original 5, adjusted by -1 = 4
    expect(adjustments[1]?.delta).toBe(1);
    expect(adjustments[1]?.newStart).toBe(4); // 5 - 1
    expect(adjustments[1]?.newEnd).toBe(7); // 4 + 3

    // Third: original 10, adjusted by cumulative delta (-1 + 1 = 0), so 10
    expect(adjustments[2]?.delta).toBe(-1);
    expect(adjustments[2]?.newStart).toBe(10); // 10 - 0 (cumulative delta) = 10
    // Let me recalculate: after first: delta = -1, after second: delta = -1 + 1 = 0
    // So third starts at 10 + 0 = 10
    expect(adjustments[2]?.newStart).toBe(10);
  });
});

