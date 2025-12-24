import { describe, it, expect } from 'vitest';
import {
  tagEntities,
  generateTag,
  parseTag,
  extractTags,
  extractTagsStrict,
  rehydrate,
  createPIIMapKey,
  type RawPIIMap,
} from '../../src/pipeline/tagger.js';
import { PIIType, SpanMatch, DetectionSource, createDefaultPolicy, SemanticAttributes } from '../../src/types/index.js';

describe('Tagger', () => {
  const defaultPolicy = createDefaultPolicy();

  describe('generateTag', () => {
    it('should generate correct tag format', () => {
      expect(generateTag(PIIType.PERSON, 1)).toBe('<PII type="PERSON" id="1"/>');
      expect(generateTag(PIIType.EMAIL, 42)).toBe('<PII type="EMAIL" id="42"/>');
    });

    it('should include gender attribute when provided', () => {
      const semantic: SemanticAttributes = { gender: 'female' };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe('<PII type="PERSON" gender="female" id="1"/>');
    });

    it('should include scope attribute when provided', () => {
      const semantic: SemanticAttributes = { scope: 'city' };
      expect(generateTag(PIIType.LOCATION, 1, semantic)).toBe('<PII type="LOCATION" scope="city" id="1"/>');
    });

    it('should include both gender and scope when provided', () => {
      const semantic: SemanticAttributes = { gender: 'male', scope: 'country' };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe('<PII type="PERSON" gender="male" scope="country" id="1"/>');
    });

    it('should not include unknown gender', () => {
      const semantic: SemanticAttributes = { gender: 'unknown' };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe('<PII type="PERSON" id="1"/>');
    });

    it('should not include unknown scope', () => {
      const semantic: SemanticAttributes = { scope: 'unknown' };
      expect(generateTag(PIIType.LOCATION, 1, semantic)).toBe('<PII type="LOCATION" id="1"/>');
    });

    it('should handle undefined semantic', () => {
      expect(generateTag(PIIType.PERSON, 1, undefined)).toBe('<PII type="PERSON" id="1"/>');
    });
  });

  describe('parseTag', () => {
    it('should parse valid tags', () => {
      const result = parseTag('<PII type="PERSON" id="1"/>');
      expect(result).toEqual({ type: PIIType.PERSON, id: 1, semantic: undefined });
    });

    it('should return null for invalid tags', () => {
      expect(parseTag('<PII type="INVALID" id="1"/>')).toBeNull();
      expect(parseTag('<PII type="PERSON"/>')).toBeNull();
      expect(parseTag('not a tag')).toBeNull();
    });

    it('should parse tags with gender attribute', () => {
      const result = parseTag('<PII type="PERSON" gender="female" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: { gender: 'female' },
      });
    });

    it('should parse tags with scope attribute', () => {
      const result = parseTag('<PII type="LOCATION" scope="city" id="1"/>');
      expect(result).toEqual({
        type: PIIType.LOCATION,
        id: 1,
        semantic: { scope: 'city' },
      });
    });

    it('should parse tags with both gender and scope', () => {
      const result = parseTag('<PII type="PERSON" gender="male" scope="country" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: { gender: 'male', scope: 'country' },
      });
    });

    it('should ignore invalid semantic values', () => {
      const result = parseTag('<PII type="PERSON" gender="invalid" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: {},
      });
    });
  });

  describe('tagEntities', () => {
    it('should replace single entity', () => {
      const text = 'Hello John Smith!';
      const matches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6,
          end: 16,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: 'John Smith',
        },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe('Hello <PII type="PERSON" id="1"/>!');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.id).toBe(1);
      expect(result.piiMap.get('PERSON_1')).toBe('John Smith');
    });

    it('should replace multiple entities', () => {
      const text = 'Email john@test.com or call +49123456789';
      const matches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 6,
          end: 19,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: 'john@test.com',
        },
        {
          type: PIIType.PHONE,
          start: 28,
          end: 40,
          confidence: 0.9,
          source: DetectionSource.REGEX,
          text: '+49123456789',
        },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe(
        'Email <PII type="EMAIL" id="1"/> or call <PII type="PHONE" id="2"/>'
      );
      expect(result.entities).toHaveLength(2);
      expect(result.piiMap.size).toBe(2);
    });

    it('should assign IDs in order of occurrence', () => {
      const text = 'A then B then C';
      const matches: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 1, confidence: 0.9, source: DetectionSource.NER, text: 'A' },
        { type: PIIType.PERSON, start: 7, end: 8, confidence: 0.9, source: DetectionSource.NER, text: 'B' },
        { type: PIIType.PERSON, start: 14, end: 15, confidence: 0.9, source: DetectionSource.NER, text: 'C' },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.entities[0]?.id).toBe(1);
      expect(result.entities[1]?.id).toBe(2);
      expect(result.entities[2]?.id).toBe(3);
    });

    it('should preserve correct offsets after replacement', () => {
      const text = 'Hello World!';
      const matches: SpanMatch[] = [];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe('Hello World!');
      expect(result.entities).toHaveLength(0);
    });

    describe('semantic attributes in tagEntities', () => {
      it('should include gender in tag when semantic is present', () => {
        const text = 'Hello Mary!';
        const matches: SpanMatch[] = [
          {
            type: PIIType.PERSON,
            start: 6,
            end: 10,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: 'Mary',
            semantic: { gender: 'female' },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.anonymizedText).toBe('Hello <PII type="PERSON" gender="female" id="1"/>!');
        expect(result.entities[0]?.semantic?.gender).toBe('female');
      });

      it('should include scope in tag when semantic is present', () => {
        const text = 'Visit Berlin!';
        const matches: SpanMatch[] = [
          {
            type: PIIType.LOCATION,
            start: 6,
            end: 12,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: 'Berlin',
            semantic: { scope: 'city' },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.anonymizedText).toBe('Visit <PII type="LOCATION" scope="city" id="1"/>!');
        expect(result.entities[0]?.semantic?.scope).toBe('city');
      });

      it('should preserve semantic attributes in entities', () => {
        const text = 'Mary in Berlin';
        const matches: SpanMatch[] = [
          {
            type: PIIType.PERSON,
            start: 0,
            end: 4,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: 'Mary',
            semantic: { gender: 'female' },
          },
          {
            type: PIIType.LOCATION,
            start: 8,
            end: 14,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: 'Berlin',
            semantic: { scope: 'city' },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.entities[0]?.semantic?.gender).toBe('female');
        expect(result.entities[1]?.semantic?.scope).toBe('city');
      });
    });
  });

  describe('extractTags', () => {
    it('should extract all tags from text', () => {
      const text = 'Hello <PII type="PERSON" id="1"/> and <PII type="EMAIL" id="2"/>!';
      const tags = extractTags(text);

      expect(tags).toHaveLength(2);
      expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1, position: 6 });
      expect(tags[1]).toMatchObject({ type: PIIType.EMAIL, id: 2, position: 38 });
    });

    describe('semantic attributes extraction', () => {
      it('should extract gender attribute', () => {
        const text = 'Hello <PII type="PERSON" gender="female" id="1"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe('female');
      });

      it('should extract scope attribute', () => {
        const text = 'Visit <PII type="LOCATION" scope="city" id="1"/> soon';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.scope).toBe('city');
      });

      it('should extract both gender and scope', () => {
        const text = 'In <PII type="LOCATION" gender="female" scope="country" id="1"/>';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe('female');
        expect(tags[0]?.semantic?.scope).toBe('country');
      });

      it('should handle fuzzy matching with semantic attributes', () => {
        // Using Unicode: \u201C = " and \u201D = "
        const text = 'Hello <PII type=\u201CPERSON\u201D gender=\u201Cmale\u201D id=\u201C1\u201D/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.type).toBe(PIIType.PERSON);
        expect(tags[0]?.semantic?.gender).toBe('male');
      });
    });

    describe('fuzzy matching for translation artifacts', () => {
      it('should handle smart quotes (curly quotes)', () => {
        // Using Unicode escape sequences: \u201C = " (left) and \u201D = " (right)
        const text = 'Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle German quotes (low-high)', () => {
        // Using Unicode: \u201E = „ (German low quote) and \u201C = " (German high quote)
        const text = 'Hello <PII type=\u201EPERSON\u201C id=\u201E1\u201C/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle French guillemets', () => {
        // Using Unicode: \u00AB = « and \u00BB = »
        const text = 'Hello <PII type=\u00ABPERSON\u00BB id=\u00AB1\u00BB/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle single quotes', () => {
        const text = "Hello <PII type='PERSON' id='1'/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle case changes in tag name and attributes', () => {
        const text = 'Hello <pii TYPE="PERSON" ID="1"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle extra whitespace', () => {
        const text = 'Hello < PII  type = "PERSON"  id = "1" / > world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle attribute reordering (id before type)', () => {
        const text = 'Hello <PII id="1" type="PERSON"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle missing self-closing slash', () => {
        const text = 'Hello <PII type="PERSON" id="1"> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle space before closing bracket', () => {
        const text = 'Hello <PII type="PERSON" id="1" /> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should handle combination of translation artifacts', () => {
        // Combination: smart quotes, extra spaces, reordered attributes, case changes
        const text = 'Hello < pii  ID = "42"  TYPE = "EMAIL" / > world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.EMAIL, id: 42 });
      });

      it('should handle multiple mangled tags', () => {
        const text = `Contact <PII type="PERSON" id="1"/> at <pii id='2' type='EMAIL'>`;
        const tags = extractTags(text);

        expect(tags).toHaveLength(2);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[1]).toMatchObject({ type: PIIType.EMAIL, id: 2 });
      });

      it('should include matchedText for accurate replacement', () => {
        const mangledTag = '< PII  type = "PERSON"  id = "1" / >';
        const text = `Hello ${mangledTag} world`;
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.matchedText).toBe(mangledTag);
      });
    });

    describe('extractTagsStrict', () => {
      it('should only match exact canonical format', () => {
        const text = 'Hello <PII type="PERSON" id="1"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it('should NOT match mangled tags with smart quotes', () => {
        // Using Unicode smart quotes: \u201C = " and \u201D = "
        const text = 'Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(0);
      });

      it('should NOT match reordered attributes', () => {
        const text = 'Hello <PII id="1" type="PERSON"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(0);
      });

      it('should match tags with gender attribute', () => {
        const text = 'Hello <PII type="PERSON" gender="female" id="1"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[0]?.semantic?.gender).toBe('female');
      });

      it('should match tags with scope attribute', () => {
        const text = 'Visit <PII type="LOCATION" scope="city" id="1"/> soon';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.LOCATION, id: 1 });
        expect(tags[0]?.semantic?.scope).toBe('city');
      });

      it('should match tags with both gender and scope', () => {
        const text = 'Hello <PII type="PERSON" gender="male" scope="country" id="1"/> test';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe('male');
        expect(tags[0]?.semantic?.scope).toBe('country');
      });

      it('should handle multiple tags with different attributes', () => {
        const text = '<PII type="PERSON" gender="female" id="1"/> lives in <PII type="LOCATION" scope="city" id="2"/>';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(2);
        expect(tags[0]?.semantic?.gender).toBe('female');
        expect(tags[1]?.semantic?.scope).toBe('city');
      });

      it('should not include semantic for tags without gender/scope', () => {
        const text = 'Email: <PII type="EMAIL" id="1"/>';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic).toBeUndefined();
      });
    });
  });

  describe('rehydrate', () => {
    it('should restore original text from anonymized text', () => {
      const originalText = 'Contact john@example.com for help';
      const matches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 8,
          end: 24,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: 'john@example.com',
        },
      ];

      const { anonymizedText, piiMap } = tagEntities(originalText, matches, defaultPolicy);
      const rehydrated = rehydrate(anonymizedText, piiMap);

      expect(rehydrated).toBe(originalText);
    });

    it('should restore text with multiple entities', () => {
      const originalText = 'John at john@test.com called +49123456789';
      const matches: SpanMatch[] = [
        { type: PIIType.PERSON, start: 0, end: 4, confidence: 0.9, source: DetectionSource.NER, text: 'John' },
        { type: PIIType.EMAIL, start: 8, end: 21, confidence: 0.98, source: DetectionSource.REGEX, text: 'john@test.com' },
        { type: PIIType.PHONE, start: 29, end: 41, confidence: 0.9, source: DetectionSource.REGEX, text: '+49123456789' },
      ];

      const { anonymizedText, piiMap } = tagEntities(originalText, matches, defaultPolicy);
      const rehydrated = rehydrate(anonymizedText, piiMap);

      expect(rehydrated).toBe(originalText);
    });

    describe('rehydration with mangled tags (post-translation)', () => {
      it('should rehydrate tags with smart quotes', () => {
        const piiMap: RawPIIMap = new Map([['PERSON_1', 'John Doe']]);
        // Using Unicode: \u201C = " and \u201D = "
        const mangledText = 'Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world';
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Hello John Doe world');
      });

      it('should rehydrate tags with German quotes', () => {
        const piiMap: RawPIIMap = new Map([['EMAIL_1', 'test@example.com']]);
        // Using Unicode: \u201E = „ and \u201C = "
        const mangledText = 'Contact <PII type=\u201EEMAIL\u201C id=\u201E1\u201C/> for help';
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Contact test@example.com for help');
      });

      it('should rehydrate tags with extra whitespace', () => {
        const piiMap: RawPIIMap = new Map([['PHONE_1', '+49123456789']]);
        const mangledText = 'Call < PII  type = "PHONE"  id = "1" / > now';
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Call +49123456789 now');
      });

      it('should rehydrate tags with reordered attributes', () => {
        const piiMap: RawPIIMap = new Map([['ORG_1', 'Acme Corp']]);
        const mangledText = 'Company: <PII id="1" type="ORG"/>';
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Company: Acme Corp');
      });

      it('should rehydrate multiple mangled tags', () => {
        const piiMap: RawPIIMap = new Map([
          ['PERSON_1', 'John Doe'],
          ['EMAIL_2', 'john@test.com'],
        ]);
        // Mix of smart quotes and curly single quotes (\u2018 and \u2019)
        const mangledText = `Hi <PII type=\u201CPERSON\u201D id=\u201C1\u201D/>, your email is <pii ID=\u20182\u2019 TYPE=\u2018EMAIL\u2019>`;
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Hi John Doe, your email is john@test.com');
      });

      it('should handle heavily mangled tags from translation', () => {
        const piiMap: RawPIIMap = new Map([['LOCATION_1', 'Berlin']]);
        // Simulating what might come back from a translation service
        // Using Unicode: \u00AB = « and \u00BB = »
        const mangledText = 'Visit < pii  TYPE = \u00ABLOCATION\u00BB  ID = \u00AB1\u00BB / > soon';
        
        const result = rehydrate(mangledText, piiMap);
        
        expect(result).toBe('Visit Berlin soon');
      });

      it('should use strict mode when specified', () => {
        const piiMap: RawPIIMap = new Map([['PERSON_1', 'John Doe']]);
        // Using Unicode smart quotes: \u201C = " and \u201D = "
        const mangledText = 'Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world';
        
        // Strict mode should NOT match the mangled tag (smart quotes)
        const result = rehydrate(mangledText, piiMap, true);
        
        // Text should be unchanged since strict mode doesn't match smart quotes
        expect(result).toBe(mangledText);
      });

      it('should preserve unmatched tags', () => {
        const piiMap: RawPIIMap = new Map([['PERSON_1', 'John Doe']]);
        // PERSON_2 is not in the map
        const mangledText = 'Hello <PII type="PERSON" id="1"/> and <PII type="PERSON" id="2"/>';
        
        const result = rehydrate(mangledText, piiMap);
        
        // Should replace PERSON_1 but leave PERSON_2
        expect(result).toBe('Hello John Doe and <PII type="PERSON" id="2"/>');
      });
    });
  });

  describe('createPIIMapKey', () => {
    it('should create correct key format', () => {
      expect(createPIIMapKey(PIIType.PERSON, 1)).toBe('PERSON_1');
      expect(createPIIMapKey(PIIType.EMAIL, 42)).toBe('EMAIL_42');
    });
  });
});

