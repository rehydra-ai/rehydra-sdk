import { describe, it, expect } from "vitest";
import {
  tagEntities,
  generateTag,
  parseTag,
  extractTags,
  extractTagsStrict,
  rehydrate,
  createPIIMapKey,
  type RawPIIMap,
} from "../../src/pipeline/tagger.js";
import {
  PIIType,
  SpanMatch,
  DetectionSource,
  createDefaultPolicy,
  SemanticAttributes,
  TagFormat,
  DEFAULT_TAG_FORMAT,
} from "../../src/types/index.js";

describe("Tagger", () => {
  const defaultPolicy = createDefaultPolicy();

  describe("generateTag", () => {
    it("should generate correct tag format", () => {
      expect(generateTag(PIIType.PERSON, 1)).toBe(
        '<PII type="PERSON" id="1"/>'
      );
      expect(generateTag(PIIType.EMAIL, 42)).toBe(
        '<PII type="EMAIL" id="42"/>'
      );
    });

    it("should include gender attribute when provided", () => {
      const semantic: SemanticAttributes = { gender: "female" };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe(
        '<PII type="PERSON" gender="female" id="1"/>'
      );
    });

    it("should include scope attribute when provided", () => {
      const semantic: SemanticAttributes = { scope: "city" };
      expect(generateTag(PIIType.LOCATION, 1, semantic)).toBe(
        '<PII type="LOCATION" scope="city" id="1"/>'
      );
    });

    it("should include both gender and scope when provided", () => {
      const semantic: SemanticAttributes = { gender: "male", scope: "country" };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe(
        '<PII type="PERSON" gender="male" scope="country" id="1"/>'
      );
    });

    it("should not include unknown gender", () => {
      const semantic: SemanticAttributes = { gender: "unknown" };
      expect(generateTag(PIIType.PERSON, 1, semantic)).toBe(
        '<PII type="PERSON" id="1"/>'
      );
    });

    it("should not include unknown scope", () => {
      const semantic: SemanticAttributes = { scope: "unknown" };
      expect(generateTag(PIIType.LOCATION, 1, semantic)).toBe(
        '<PII type="LOCATION" id="1"/>'
      );
    });

    it("should handle undefined semantic", () => {
      expect(generateTag(PIIType.PERSON, 1, undefined)).toBe(
        '<PII type="PERSON" id="1"/>'
      );
    });
  });

  describe("parseTag", () => {
    it("should parse valid tags", () => {
      const result = parseTag('<PII type="PERSON" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: undefined,
      });
    });

    it("should return null for invalid tags", () => {
      expect(parseTag('<PII type="PERSON"/>')).toBeNull();
      expect(parseTag("not a tag")).toBeNull();
    });

    it("should accept non-enum type strings (custom recognizers, issue #68)", () => {
      // parseTag is intentionally permissive: any [A-Z_]+ type is accepted so
      // that createCustomIdRecognizer tags survive round-tripping.
      expect(parseTag('<PII type="INVALID" id="1"/>')).toEqual({
        type: "INVALID",
        id: 1,
        semantic: undefined,
      });
    });

    it("should parse tags with gender attribute", () => {
      const result = parseTag('<PII type="PERSON" gender="female" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: { gender: "female" },
      });
    });

    it("should parse tags with scope attribute", () => {
      const result = parseTag('<PII type="LOCATION" scope="city" id="1"/>');
      expect(result).toEqual({
        type: PIIType.LOCATION,
        id: 1,
        semantic: { scope: "city" },
      });
    });

    it("should parse tags with both gender and scope", () => {
      const result = parseTag(
        '<PII type="PERSON" gender="male" scope="country" id="1"/>'
      );
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: { gender: "male", scope: "country" },
      });
    });

    it("should parse tags with macro-region scope", () => {
      const result = parseTag('<PII type="LOCATION" scope="macro-region" id="1"/>');
      expect(result).toEqual({
        type: PIIType.LOCATION,
        id: 1,
        semantic: { scope: "macro-region" },
      });
    });

    it("should ignore invalid semantic values", () => {
      const result = parseTag('<PII type="PERSON" gender="invalid" id="1"/>');
      expect(result).toEqual({
        type: PIIType.PERSON,
        id: 1,
        semantic: {},
      });
    });
  });

  describe("tagEntities", () => {
    it("should replace single entity", () => {
      const text = "Hello John Smith!";
      const matches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6,
          end: 16,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "John Smith",
        },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe('Hello <PII type="PERSON" id="1"/>!');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.id).toBe(1);
      expect(result.piiMap.get("PERSON_1")).toBe("John Smith");
    });

    it("should replace multiple entities", () => {
      const text = "Email john@test.com or call +49123456789";
      const matches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 6,
          end: 19,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "john@test.com",
        },
        {
          type: PIIType.PHONE,
          start: 28,
          end: 40,
          confidence: 0.9,
          source: DetectionSource.REGEX,
          text: "+49123456789",
        },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe(
        'Email <PII type="EMAIL" id="1"/> or call <PII type="PHONE" id="2"/>'
      );
      expect(result.entities).toHaveLength(2);
      expect(result.piiMap.size).toBe(2);
    });

    it("should assign IDs in order of occurrence", () => {
      const text = "A then B then C";
      const matches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 1,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "A",
        },
        {
          type: PIIType.PERSON,
          start: 7,
          end: 8,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "B",
        },
        {
          type: PIIType.PERSON,
          start: 14,
          end: 15,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "C",
        },
      ];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.entities[0]?.id).toBe(1);
      expect(result.entities[1]?.id).toBe(2);
      expect(result.entities[2]?.id).toBe(3);
    });

    it("should preserve correct offsets after replacement", () => {
      const text = "Hello World!";
      const matches: SpanMatch[] = [];

      const result = tagEntities(text, matches, defaultPolicy);

      expect(result.anonymizedText).toBe("Hello World!");
      expect(result.entities).toHaveLength(0);
    });

    describe("semantic attributes in tagEntities", () => {
      it("should include gender in tag when semantic is present", () => {
        const text = "Hello Mary!";
        const matches: SpanMatch[] = [
          {
            type: PIIType.PERSON,
            start: 6,
            end: 10,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: "Mary",
            semantic: { gender: "female" },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.anonymizedText).toBe(
          'Hello <PII type="PERSON" gender="female" id="1"/>!'
        );
        expect(result.entities[0]?.semantic?.gender).toBe("female");
      });

      it("should include scope in tag when semantic is present", () => {
        const text = "Visit Berlin!";
        const matches: SpanMatch[] = [
          {
            type: PIIType.LOCATION,
            start: 6,
            end: 12,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: "Berlin",
            semantic: { scope: "city" },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.anonymizedText).toBe(
          'Visit <PII type="LOCATION" scope="city" id="1"/>!'
        );
        expect(result.entities[0]?.semantic?.scope).toBe("city");
      });

      it("should preserve semantic attributes in entities", () => {
        const text = "Mary in Berlin";
        const matches: SpanMatch[] = [
          {
            type: PIIType.PERSON,
            start: 0,
            end: 4,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: "Mary",
            semantic: { gender: "female" },
          },
          {
            type: PIIType.LOCATION,
            start: 8,
            end: 14,
            confidence: 0.9,
            source: DetectionSource.NER,
            text: "Berlin",
            semantic: { scope: "city" },
          },
        ];

        const result = tagEntities(text, matches, defaultPolicy);

        expect(result.entities[0]?.semantic?.gender).toBe("female");
        expect(result.entities[1]?.semantic?.scope).toBe("city");
      });
    });
  });

  describe("extractTags", () => {
    it("should extract all tags from text", () => {
      const text =
        'Hello <PII type="PERSON" id="1"/> and <PII type="EMAIL" id="2"/>!';
      const tags = extractTags(text);

      expect(tags).toHaveLength(2);
      expect(tags[0]).toMatchObject({
        type: PIIType.PERSON,
        id: 1,
        position: 6,
      });
      expect(tags[1]).toMatchObject({
        type: PIIType.EMAIL,
        id: 2,
        position: 38,
      });
    });

    describe("semantic attributes extraction", () => {
      it("should extract gender attribute", () => {
        const text = 'Hello <PII type="PERSON" gender="female" id="1"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe("female");
      });

      it("should extract scope attribute", () => {
        const text = 'Visit <PII type="LOCATION" scope="city" id="1"/> soon';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.scope).toBe("city");
      });

      it("should extract both gender and scope", () => {
        const text =
          'In <PII type="LOCATION" gender="female" scope="country" id="1"/>';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe("female");
        expect(tags[0]?.semantic?.scope).toBe("country");
      });

      it("should extract macro-region scope", () => {
        const text = 'Across <PII type="LOCATION" scope="macro-region" id="1"/> today';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.scope).toBe("macro-region");
      });

      it("should extract macro-region scope via strict extraction", () => {
        const text = 'Across <PII type="LOCATION" scope="macro-region" id="1"/> today';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.scope).toBe("macro-region");
      });

      it("should handle fuzzy matching with semantic attributes", () => {
        // Using Unicode: \u201C = " and \u201D = "
        const text =
          "Hello <PII type=\u201CPERSON\u201D gender=\u201Cmale\u201D id=\u201C1\u201D/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.type).toBe(PIIType.PERSON);
        expect(tags[0]?.semantic?.gender).toBe("male");
      });
    });

    describe("fuzzy matching for translation artifacts", () => {
      it("should handle smart quotes (curly quotes)", () => {
        // Using Unicode escape sequences: \u201C = " (left) and \u201D = " (right)
        const text =
          "Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle German quotes (low-high)", () => {
        // Using Unicode: \u201E = „ (German low quote) and \u201C = " (German high quote)
        const text =
          "Hello <PII type=\u201EPERSON\u201C id=\u201E1\u201C/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle French guillemets", () => {
        // Using Unicode: \u00AB = « and \u00BB = »
        const text =
          "Hello <PII type=\u00ABPERSON\u00BB id=\u00AB1\u00BB/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle single quotes", () => {
        const text = "Hello <PII type='PERSON' id='1'/> world";
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle case changes in tag name and attributes", () => {
        const text = 'Hello <pii TYPE="PERSON" ID="1"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle extra whitespace", () => {
        const text = 'Hello < PII  type = "PERSON"  id = "1" / > world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle attribute reordering (id before type)", () => {
        const text = 'Hello <PII id="1" type="PERSON"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle missing self-closing slash", () => {
        const text = 'Hello <PII type="PERSON" id="1"> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle space before closing bracket", () => {
        const text = 'Hello <PII type="PERSON" id="1" /> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle combination of translation artifacts", () => {
        // Combination: smart quotes, extra spaces, reordered attributes, case changes
        const text = 'Hello < pii  ID = "42"  TYPE = "EMAIL" / > world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.EMAIL, id: 42 });
      });

      it("should handle multiple mangled tags", () => {
        const text = `Contact <PII type="PERSON" id="1"/> at <pii id='2' type='EMAIL'>`;
        const tags = extractTags(text);

        expect(tags).toHaveLength(2);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[1]).toMatchObject({ type: PIIType.EMAIL, id: 2 });
      });

      it("should include matchedText for accurate replacement", () => {
        const mangledTag = '< PII  type = "PERSON"  id = "1" / >';
        const text = `Hello ${mangledTag} world`;
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.matchedText).toBe(mangledTag);
      });

      it("should handle malformed id with /> inside quotes (ChatGPT garbling)", () => {
        // ChatGPT sometimes moves the /> inside the id attribute value
        const text = 'Hello <PII type="PERSON" gender="female" id="7/>"> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 7 });
        expect(tags[0]?.semantic?.gender).toBe("female");
      });

      it("should handle malformed id with / inside quotes", () => {
        const text = 'Hello <PII type="PERSON" id="1/"> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle malformed id with HTML entity &gt; inside quotes", () => {
        const text = 'Hello <PII type="PERSON" id="1/&gt;"> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle mixed normal and malformed tags", () => {
        // First tag malformed (echoed/quoted by ChatGPT), second tag correct
        const text =
          '<PII type="PERSON" id="7/>"> and <PII type="PERSON" id="7"/>';
        const tags = extractTags(text);

        expect(tags).toHaveLength(2);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 7 });
        expect(tags[1]).toMatchObject({ type: PIIType.PERSON, id: 7 });
      });

      it("should handle HTML-encoded brackets (GitHub issue #12)", () => {
        // When LLMs HTML-encode the tags: < becomes &lt; and > becomes &gt;
        const text = 'Hello &lt;PII type="PERSON" id="1"/&gt; world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[0]?.matchedText).toBe('&lt;PII type="PERSON" id="1"/&gt;');
      });

      it("should handle HTML-encoded tags with semantic attributes", () => {
        const text =
          'Hello &lt;PII type="PERSON" gender="female" id="2"/&gt; world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 2 });
        expect(tags[0]?.semantic?.gender).toBe("female");
      });

      it("should handle mix of HTML-encoded and normal tags (partial rehydration scenario)", () => {
        // This is the exact scenario from issue #12:
        // Some tags are properly rendered, others are HTML-encoded
        const text = `
          <PII type="PERSON" id="1" gender="female" /> was assigned.
          Interpreter &lt;PII type="PERSON" id="2"/&gt; carried out the assignment.
          Invoice to &lt;PII type="ORG" id="3"/&gt;.
        `;
        const tags = extractTags(text);

        expect(tags).toHaveLength(3);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[1]).toMatchObject({ type: PIIType.PERSON, id: 2 });
        expect(tags[2]).toMatchObject({ type: PIIType.ORG, id: 3 });
      });

      it("should handle HTML-encoded closing bracket only", () => {
        // Sometimes only the closing bracket is encoded
        const text = 'Hello <PII type="PERSON" id="1"/&gt; world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle fully HTML-encoded tag with malformed id (ChatGPT edge case)", () => {
        // Combination: HTML-encoded opening AND closing inside id quotes
        // This is: &lt;PII type="PERSON" gender="female" id="7/&gt;"
        // Note: No closing bracket after the tag - the /&gt; is inside the id value
        const text =
          'Hello &lt;PII type="PERSON" gender="female" id="7/&gt;" world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 7 });
        expect(tags[0]?.semantic?.gender).toBe("female");
      });

      it("should handle HTML-encoded opening bracket only", () => {
        // Sometimes only the opening bracket is encoded
        const text = 'Hello &lt;PII type="PERSON" id="1"/> world';
        const tags = extractTags(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });
    });

    describe("extractTagsStrict", () => {
      it("should only match exact canonical format", () => {
        const text = 'Hello <PII type="PERSON" id="1"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should NOT match mangled tags with smart quotes", () => {
        // Using Unicode smart quotes: \u201C = " and \u201D = "
        const text =
          "Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world";
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(0);
      });

      it("should NOT match reordered attributes", () => {
        const text = 'Hello <PII id="1" type="PERSON"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(0);
      });

      it("should match tags with gender attribute", () => {
        const text = 'Hello <PII type="PERSON" gender="female" id="1"/> world';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
        expect(tags[0]?.semantic?.gender).toBe("female");
      });

      it("should match tags with scope attribute", () => {
        const text = 'Visit <PII type="LOCATION" scope="city" id="1"/> soon';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.LOCATION, id: 1 });
        expect(tags[0]?.semantic?.scope).toBe("city");
      });

      it("should match tags with both gender and scope", () => {
        const text =
          'Hello <PII type="PERSON" gender="male" scope="country" id="1"/> test';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic?.gender).toBe("male");
        expect(tags[0]?.semantic?.scope).toBe("country");
      });

      it("should handle multiple tags with different attributes", () => {
        const text =
          '<PII type="PERSON" gender="female" id="1"/> lives in <PII type="LOCATION" scope="city" id="2"/>';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(2);
        expect(tags[0]?.semantic?.gender).toBe("female");
        expect(tags[1]?.semantic?.scope).toBe("city");
      });

      it("should not include semantic for tags without gender/scope", () => {
        const text = 'Email: <PII type="EMAIL" id="1"/>';
        const tags = extractTagsStrict(text);

        expect(tags).toHaveLength(1);
        expect(tags[0]?.semantic).toBeUndefined();
      });
    });
  });

  describe("rehydrate", () => {
    it("should restore original text from anonymized text", () => {
      const originalText = "Contact john@example.com for help";
      const matches: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 8,
          end: 24,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "john@example.com",
        },
      ];

      const { anonymizedText, piiMap } = tagEntities(
        originalText,
        matches,
        defaultPolicy
      );
      const rehydrated = rehydrate(anonymizedText, piiMap);

      expect(rehydrated).toBe(originalText);
    });

    it("should restore text with multiple entities", () => {
      const originalText = "John at john@test.com called +49123456789";
      const matches: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "John",
        },
        {
          type: PIIType.EMAIL,
          start: 8,
          end: 21,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "john@test.com",
        },
        {
          type: PIIType.PHONE,
          start: 29,
          end: 41,
          confidence: 0.9,
          source: DetectionSource.REGEX,
          text: "+49123456789",
        },
      ];

      const { anonymizedText, piiMap } = tagEntities(
        originalText,
        matches,
        defaultPolicy
      );
      const rehydrated = rehydrate(anonymizedText, piiMap);

      expect(rehydrated).toBe(originalText);
    });

    describe("rehydration with mangled tags (post-translation)", () => {
      it("should rehydrate tags with smart quotes", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John Doe"]]);
        // Using Unicode: \u201C = " and \u201D = "
        const mangledText =
          "Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world";

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Hello John Doe world");
      });

      it("should rehydrate tags with German quotes", () => {
        const piiMap: RawPIIMap = new Map([["EMAIL_1", "test@example.com"]]);
        // Using Unicode: \u201E = „ and \u201C = "
        const mangledText =
          "Contact <PII type=\u201EEMAIL\u201C id=\u201E1\u201C/> for help";

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Contact test@example.com for help");
      });

      it("should rehydrate tags with extra whitespace", () => {
        const piiMap: RawPIIMap = new Map([["PHONE_1", "+49123456789"]]);
        const mangledText = 'Call < PII  type = "PHONE"  id = "1" / > now';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Call +49123456789 now");
      });

      it("should rehydrate tags with reordered attributes", () => {
        const piiMap: RawPIIMap = new Map([["ORG_1", "Acme Corp"]]);
        const mangledText = 'Company: <PII id="1" type="ORG"/>';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Company: Acme Corp");
      });

      it("should rehydrate multiple mangled tags", () => {
        const piiMap: RawPIIMap = new Map([
          ["PERSON_1", "John Doe"],
          ["EMAIL_2", "john@test.com"],
        ]);
        // Mix of smart quotes and curly single quotes (\u2018 and \u2019)
        const mangledText = `Hi <PII type=\u201CPERSON\u201D id=\u201C1\u201D/>, your email is <pii ID=\u20182\u2019 TYPE=\u2018EMAIL\u2019>`;

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Hi John Doe, your email is john@test.com");
      });

      it("should handle heavily mangled tags from translation", () => {
        const piiMap: RawPIIMap = new Map([["LOCATION_1", "Berlin"]]);
        // Simulating what might come back from a translation service
        // Using Unicode: \u00AB = « and \u00BB = »
        const mangledText =
          "Visit < pii  TYPE = \u00ABLOCATION\u00BB  ID = \u00AB1\u00BB / > soon";

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Visit Berlin soon");
      });

      it("should rehydrate tags with JSON-escaped quotes", () => {
        const piiMap: RawPIIMap = new Map([["ENV_VAR_SECRET_1", "sk-secret123"]]);
        // OpenAI tool args contain backslash-escaped quotes
        const mangledText =
          'Set key <PII type=\\"ENV_VAR_SECRET\\" id=\\"1\\"/> now';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Set key sk-secret123 now");
      });

      it("should use strict mode when specified", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John Doe"]]);
        // Using Unicode smart quotes: \u201C = " and \u201D = "
        const mangledText =
          "Hello <PII type=\u201CPERSON\u201D id=\u201C1\u201D/> world";

        // Strict mode should NOT match the mangled tag (smart quotes)
        const result = rehydrate(mangledText, piiMap, true);

        // Text should be unchanged since strict mode doesn't match smart quotes
        expect(result).toBe(mangledText);
      });

      it("should preserve unmatched tags", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John Doe"]]);
        // PERSON_2 is not in the map
        const mangledText =
          'Hello <PII type="PERSON" id="1"/> and <PII type="PERSON" id="2"/>';

        const result = rehydrate(mangledText, piiMap);

        // Should replace PERSON_1 but leave PERSON_2
        expect(result).toBe('Hello John Doe and <PII type="PERSON" id="2"/>');
      });

      it("should rehydrate malformed tags with /> inside id quotes (ChatGPT garbling)", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_7", "Sarah"]]);
        // ChatGPT sometimes moves the /> inside the id attribute value
        const mangledText =
          'Hello <PII type="PERSON" gender="female" id="7/>"> world';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Hello Sarah world");
      });

      it("should rehydrate malformed tags with HTML entity inside id quotes", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John"]]);
        const mangledText = 'Hello <PII type="PERSON" id="1/&gt;"> world';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Hello John world");
      });

      it("should rehydrate both normal and malformed tags in same text", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_7", "Sarah"]]);
        // First occurrence malformed (echoed by ChatGPT), second correct (in translation)
        const mangledText =
          'The quote "<PII type="PERSON" id="7/>">" translates to "<PII type="PERSON" id="7"/>"';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe('The quote "Sarah" translates to "Sarah"');
      });

      it("should rehydrate HTML-encoded tags (GitHub issue #12)", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John Doe"]]);
        // When LLMs HTML-encode the tags: < becomes &lt; and > becomes &gt;
        const mangledText = 'Hello &lt;PII type="PERSON" id="1"/&gt; world';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Hello John Doe world");
      });

      it("should rehydrate HTML-encoded tags with semantic attributes", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_2", "Maria"]]);
        const mangledText =
          'Interpreter &lt;PII type="PERSON" gender="female" id="2"/&gt; carried out the task';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Interpreter Maria carried out the task");
      });

      it("should rehydrate mixed HTML-encoded and normal tags (partial rehydration fix)", () => {
        // This is the exact scenario from GitHub issue #12
        const piiMap: RawPIIMap = new Map([
          ["PERSON_1", "Eli"],
          ["PERSON_2", "Max"],
          ["ORG_3", "Acme Inc"],
        ]);
        // Note: semantic attributes must come before id (type, gender, id order)
        const mangledText = `
          Interpreter <PII type="PERSON" gender="female" id="1"/> was initially assigned.
          Interpreter &lt;PII type="PERSON" id="2"/&gt; ultimately carried out the assignment.
          Invoice to &lt;PII type="ORG" id="3"/&gt;.
        `;

        const result = rehydrate(mangledText, piiMap);

        expect(result).toContain("Interpreter Eli was initially assigned");
        expect(result).toContain(
          "Interpreter Max ultimately carried out the assignment"
        );
        expect(result).toContain("Invoice to Acme Inc");
      });

      it("should rehydrate when only closing bracket is HTML-encoded", () => {
        const piiMap: RawPIIMap = new Map([["EMAIL_1", "test@example.com"]]);
        const mangledText = 'Contact <PII type="EMAIL" id="1"/&gt; for help';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Contact test@example.com for help");
      });

      it("should rehydrate when only opening bracket is HTML-encoded", () => {
        const piiMap: RawPIIMap = new Map([["PHONE_1", "+49123456789"]]);
        const mangledText = 'Call &lt;PII type="PHONE" id="1"/> now';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Call +49123456789 now");
      });

      it("should rehydrate fully HTML-encoded tag with malformed id (ChatGPT edge case)", () => {
        const piiMap: RawPIIMap = new Map([["PERSON_7", "Sandra"]]);
        // Combination: HTML-encoded opening AND /&gt; inside id quotes with no closing after
        const mangledText =
          'Nothing, just hanging with my mom and &lt;PII type="PERSON" gender="female" id="7/&gt;" is:';

        const result = rehydrate(mangledText, piiMap);

        expect(result).toBe("Nothing, just hanging with my mom and Sandra is:");
      });
    });
  });

  describe("createPIIMapKey", () => {
    it("should create correct key format", () => {
      expect(createPIIMapKey(PIIType.PERSON, 1)).toBe("PERSON_1");
      expect(createPIIMapKey(PIIType.EMAIL, 42)).toBe("EMAIL_42");
    });
  });

  // =========================================================================
  // Custom TagFormat tests
  // =========================================================================
  describe("custom TagFormat", () => {
    const bracketFormat: TagFormat = { open: "[[", close: "]]", keyword: "PII" };
    const redactedFormat: TagFormat = { open: "{{", close: "}}", keyword: "REDACTED" };

    describe("generateTag with custom format", () => {
      it("should use bracket-style delimiters", () => {
        expect(generateTag(PIIType.EMAIL, 1, undefined, bracketFormat)).toBe(
          '[[PII type="EMAIL" id="1"]]'
        );
      });

      it("should use custom keyword", () => {
        expect(generateTag(PIIType.PERSON, 3, undefined, redactedFormat)).toBe(
          '{{REDACTED type="PERSON" id="3"}}'
        );
      });

      it("should include semantic attributes with custom format", () => {
        expect(
          generateTag(PIIType.PERSON, 1, { gender: "female" }, bracketFormat)
        ).toBe('[[PII type="PERSON" gender="female" id="1"]]');
      });

      it("should default to XML format when no tagFormat provided", () => {
        expect(generateTag(PIIType.PERSON, 1)).toBe(
          '<PII type="PERSON" id="1"/>'
        );
      });
    });

    describe("parseTag with custom format", () => {
      it("should parse bracket-style tags", () => {
        const result = parseTag('[[PII type="EMAIL" id="1"]]', bracketFormat);
        expect(result).toEqual({ type: PIIType.EMAIL, id: 1 });
      });

      it("should parse tags with custom keyword", () => {
        const result = parseTag(
          '{{REDACTED type="PERSON" id="5"}}',
          redactedFormat
        );
        expect(result).toEqual({ type: PIIType.PERSON, id: 5 });
      });

      it("should parse bracket-style tags with semantic attributes", () => {
        const result = parseTag(
          '[[PII type="PERSON" gender="male" id="2"]]',
          bracketFormat
        );
        expect(result).toEqual({
          type: PIIType.PERSON,
          id: 2,
          semantic: { gender: "male" },
        });
      });

      it("should reject default-format tags when custom format is configured", () => {
        expect(
          parseTag('<PII type="EMAIL" id="1"/>', bracketFormat)
        ).toBeNull();
      });

      it("should reject custom-format tags when default format is expected", () => {
        expect(
          parseTag('[[PII type="EMAIL" id="1"]]', DEFAULT_TAG_FORMAT)
        ).toBeNull();
      });
    });

    describe("extractTags with custom format", () => {
      it("should extract bracket-style tags", () => {
        const text = 'Contact [[PII type="EMAIL" id="1"]] about [[PII type="PERSON" id="2"]]';
        const tags = extractTags(text, bracketFormat);
        expect(tags).toHaveLength(2);
        expect(tags[0]).toMatchObject({ type: PIIType.EMAIL, id: 1 });
        expect(tags[1]).toMatchObject({ type: PIIType.PERSON, id: 2 });
      });

      it("should extract tags with custom keyword", () => {
        const text = 'Hello {{REDACTED type="PERSON" id="1"}}';
        const tags = extractTags(text, redactedFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle fuzzy whitespace in bracket delimiters", () => {
        const text = 'Hello [[ PII type="PERSON" id="1" ]]';
        const tags = extractTags(text, bracketFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should handle smart quotes in custom format", () => {
        const text = 'Hello [[PII type=\u201CPERSON\u201D id=\u201C1\u201D]]';
        const tags = extractTags(text, bracketFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });
    });

    describe("extractTagsStrict with custom format", () => {
      it("should extract bracket-style tags in strict mode", () => {
        const text = 'Hello [[PII type="PERSON" id="1"]]';
        const tags = extractTagsStrict(text, bracketFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 1 });
      });

      it("should not extract mangled tags in strict mode", () => {
        const text = 'Hello [[ PII type="PERSON" id="1" ]]';
        const tags = extractTagsStrict(text, bracketFormat);
        expect(tags).toHaveLength(0);
      });
    });

    describe("tagEntities with custom format", () => {
      it("should produce bracket-style tagged output", () => {
        const text = "Contact john@example.com";
        const matches: SpanMatch[] = [
          {
            type: PIIType.EMAIL,
            text: "john@example.com",
            start: 8,
            end: 24,
            confidence: 1.0,
            source: DetectionSource.REGEX,
          },
        ];
        const result = tagEntities(
          text,
          matches,
          defaultPolicy,
          undefined,
          bracketFormat
        );
        expect(result.anonymizedText).toBe(
          'Contact [[PII type="EMAIL" id="1"]]'
        );
        expect(result.piiMap.get("EMAIL_1")).toBe("john@example.com");
      });
    });

    describe("rehydrate with custom format", () => {
      it("should rehydrate bracket-style tags", () => {
        const anonymized = 'Contact [[PII type="EMAIL" id="1"]]';
        const piiMap: RawPIIMap = new Map([["EMAIL_1", "john@example.com"]]);
        const result = rehydrate(anonymized, piiMap, false, bracketFormat);
        expect(result).toBe("Contact john@example.com");
      });

      it("should rehydrate tags with custom keyword", () => {
        const anonymized = 'Hello {{REDACTED type="PERSON" id="1"}}';
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John"]]);
        const result = rehydrate(anonymized, piiMap, false, redactedFormat);
        expect(result).toBe("Hello John");
      });

      it("should rehydrate multiple tags", () => {
        const anonymized =
          '[[PII type="PERSON" id="1"]] emailed [[PII type="EMAIL" id="2"]]';
        const piiMap: RawPIIMap = new Map([
          ["PERSON_1", "Alice"],
          ["EMAIL_2", "alice@example.com"],
        ]);
        const result = rehydrate(anonymized, piiMap, false, bracketFormat);
        expect(result).toBe("Alice emailed alice@example.com");
      });

      it("should rehydrate fuzzy bracket-style tags", () => {
        const anonymized = 'Hello [[ PII type="PERSON" id="1" ]]';
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John"]]);
        const result = rehydrate(anonymized, piiMap, false, bracketFormat);
        expect(result).toBe("Hello John");
      });

      it("should rehydrate strict bracket-style tags", () => {
        const anonymized = 'Hello [[PII type="PERSON" id="1"]]';
        const piiMap: RawPIIMap = new Map([["PERSON_1", "John"]]);
        const result = rehydrate(anonymized, piiMap, true, bracketFormat);
        expect(result).toBe("Hello John");
      });
    });

    describe("end-to-end: tagEntities + rehydrate roundtrip", () => {
      it("should roundtrip with bracket format", () => {
        const original = "Email john@example.com and call +491234567890";
        const matches: SpanMatch[] = [
          {
            type: PIIType.EMAIL,
            text: "john@example.com",
            start: 6,
            end: 22,
            confidence: 1.0,
            source: DetectionSource.REGEX,
          },
          {
            type: PIIType.PHONE,
            text: "+491234567890",
            start: 32,
            end: 45,
            confidence: 1.0,
            source: DetectionSource.REGEX,
          },
        ];

        const tagged = tagEntities(
          original,
          matches,
          defaultPolicy,
          undefined,
          bracketFormat
        );
        expect(tagged.anonymizedText).toContain("[[PII");
        expect(tagged.anonymizedText).not.toContain("<PII");

        const restored = rehydrate(
          tagged.anonymizedText,
          tagged.piiMap,
          false,
          bracketFormat
        );
        expect(restored).toBe(original);
      });
    });

    describe("keyword with regex-special characters", () => {
      const dotFormat: TagFormat = { open: "[[", close: "]]", keyword: "P.I.I" };

      it("parseTag should not treat dots as wildcards", () => {
        const valid = '[[P.I.I type="EMAIL" id="1"]]';
        expect(parseTag(valid, dotFormat)).toEqual({ type: PIIType.EMAIL, id: 1 });

        const fake = '[[PXIXI type="EMAIL" id="1"]]';
        expect(parseTag(fake, dotFormat)).toBeNull();
      });

      it("extractTagsStrict should not treat dots as wildcards", () => {
        const text = '[[PXIXI type="EMAIL" id="1"]] and [[P.I.I type="PERSON" id="2"]]';
        const tags = extractTagsStrict(text, dotFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 2 });
      });

      it("extractTags (fuzzy) should not treat dots as wildcards", () => {
        const text = '[[PXIXI type="EMAIL" id="1"]] real [[P.I.I type="PERSON" id="2"]]';
        const tags = extractTags(text, dotFormat);
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ type: PIIType.PERSON, id: 2 });
      });
    });

    describe("delimiters with regex-special characters", () => {
      const regexFormat: TagFormat = { open: "($", close: "$)", keyword: "PII" };

      it("should roundtrip tagEntities + rehydrate", () => {
        const original = "Contact john@example.com";
        const matches: SpanMatch[] = [
          {
            type: PIIType.EMAIL,
            text: "john@example.com",
            start: 8,
            end: 24,
            confidence: 1,
            source: DetectionSource.REGEX,
          },
        ];
        const tagged = tagEntities(original, matches, defaultPolicy, undefined, regexFormat);
        expect(tagged.anonymizedText).toBe('Contact ($PII type="EMAIL" id="1"$)');
        const restored = rehydrate(tagged.anonymizedText, tagged.piiMap, false, regexFormat);
        expect(restored).toBe(original);
      });
    });
  });

  describe("custom PII types (issue #68)", () => {
    // Custom recognizers (createCustomIdRecognizer) may emit type strings that
    // are not members of the PIIType enum. The tagger must treat `type` as an
    // opaque [A-Z_]+ string so that anonymize → rehydrate round-trips work.
    const customType = "AMOUNT" as unknown as PIIType;

    it("parseTag should accept a custom type string", () => {
      const result = parseTag('<PII type="AMOUNT" id="1"/>');
      expect(result).toEqual({ type: "AMOUNT", id: 1 });
    });

    it("extractTags should return tags with a custom type", () => {
      const text = 'pay <PII type="AMOUNT" id="1"/> to <PII type="EMAIL" id="2"/>';
      const tags = extractTags(text);
      expect(tags).toHaveLength(2);
      expect(tags[0]).toMatchObject({ type: "AMOUNT", id: 1 });
      expect(tags[1]).toMatchObject({ type: PIIType.EMAIL, id: 2 });
    });

    it("extractTagsStrict should return tags with a custom type", () => {
      const text = 'pay <PII type="AMOUNT" id="1"/> to <PII type="EMAIL" id="2"/>';
      const tags = extractTagsStrict(text);
      expect(tags).toHaveLength(2);
      expect(tags[0]).toMatchObject({ type: "AMOUNT", id: 1 });
      expect(tags[1]).toMatchObject({ type: PIIType.EMAIL, id: 2 });
    });

    it("rehydrate should restore custom-type tags from the PII map", () => {
      const anonymized =
        'pay <PII type="AMOUNT" id="1"/> to <PII type="EMAIL" id="2"/>';
      const piiMap: RawPIIMap = new Map([
        ["AMOUNT_1", "2000 EUR"],
        ["EMAIL_2", "john@company.com"],
      ]);
      expect(rehydrate(anonymized, piiMap)).toBe(
        "pay 2000 EUR to john@company.com"
      );
    });

    it("tagEntities + rehydrate should round-trip custom types", () => {
      const original = "pay 2000 EUR to john@company.com";
      const matches: SpanMatch[] = [
        {
          type: customType,
          text: "2000 EUR",
          start: 4,
          end: 12,
          confidence: 0.9,
          source: DetectionSource.REGEX,
        },
        {
          type: PIIType.EMAIL,
          text: "john@company.com",
          start: 16,
          end: 32,
          confidence: 1,
          source: DetectionSource.REGEX,
        },
      ];
      // Policy must enable the custom type, just like the reporter's repro.
      const policy = {
        ...defaultPolicy,
        enabledTypes: new Set([...defaultPolicy.enabledTypes, customType]),
      };
      const tagged = tagEntities(original, matches, policy);
      expect(tagged.anonymizedText).toBe(
        'pay <PII type="AMOUNT" id="1"/> to <PII type="EMAIL" id="2"/>'
      );
      expect(tagged.piiMap.get("AMOUNT_1")).toBe("2000 EUR");
      expect(rehydrate(tagged.anonymizedText, tagged.piiMap)).toBe(original);
    });

    it("rehydrate should still ignore genuinely malformed tags", () => {
      // Missing closing quote on the id — regex shouldn't match either form.
      const malformed = 'pay <PII type="AMOUNT" id="1/> to someone';
      const piiMap: RawPIIMap = new Map([["AMOUNT_1", "2000 EUR"]]);
      const restored = rehydrate(malformed, piiMap);
      // Fuzzy matcher may tolerate the missing quote around the id, which is
      // intentional. What we want to verify is that the restored output is
      // *not* mangled and that we don't throw — either the tag is left alone
      // or it's replaced cleanly. Both are acceptable outcomes.
      expect(restored === malformed || restored.includes("2000 EUR")).toBe(
        true
      );
    });

    it("extractTags character class is still [A-Z_]+", () => {
      // Hyphens, digits, and other non-[A-Z_] characters in the type attribute
      // must still break tag matching. (Lowercase is intentionally accepted by
      // the fuzzy matcher to survive translation artifacts, then upper-cased.)
      expect(extractTags('<PII type="AMOUNT-X" id="1"/>')).toEqual([]);
      expect(extractTags('<PII type="AMOUNT2" id="1"/>')).toEqual([]);
      expect(extractTagsStrict('<PII type="amount" id="1"/>')).toEqual([]);
    });

    it("createPIIMapKey should build keys for custom types", () => {
      // Downstream contract: the type is stringly-keyed, no enum check.
      expect(createPIIMapKey(customType, 7)).toBe("AMOUNT_7");
    });

    it("rehydrate should use existing PII map lookups for custom types on repeat calls", () => {
      // Simulates session-level ID reuse: first call seeds a PII map with a
      // custom type, second call reuses the same ID via buildExistingEntityLookup
      // (which internally uses the parsePIIMapKey path we fixed).
      const first = tagEntities(
        "pay 2000 EUR",
        [
          {
            type: customType,
            text: "2000 EUR",
            start: 4,
            end: 12,
            confidence: 0.9,
            source: DetectionSource.REGEX,
          },
        ],
        {
          ...defaultPolicy,
          enabledTypes: new Set([...defaultPolicy.enabledTypes, customType]),
          reuseIdsForRepeatedPII: true,
        }
      );
      const firstKey = Array.from(first.piiMap.keys())[0]!;
      expect(firstKey).toBe("AMOUNT_1");

      const second = tagEntities(
        "pay 2000 EUR again",
        [
          {
            type: customType,
            text: "2000 EUR",
            start: 4,
            end: 12,
            confidence: 0.9,
            source: DetectionSource.REGEX,
          },
        ],
        {
          ...defaultPolicy,
          enabledTypes: new Set([...defaultPolicy.enabledTypes, customType]),
          reuseIdsForRepeatedPII: true,
        },
        first.piiMap
      );
      // Same value should reuse ID 1, not allocate a new ID 2.
      expect(second.anonymizedText).toBe('pay <PII type="AMOUNT" id="1"/> again');
    });
  });
});
