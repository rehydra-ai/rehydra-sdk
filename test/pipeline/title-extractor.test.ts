import { describe, it, expect } from "vitest";
import {
  extractTitle,
  extractTitlesFromSpans,
  mergeAdjacentTitleSpans,
  isOnlyTitle,
  getTitlesForLanguage,
  getAllTitles,
  startsWithTitle,
} from "../../src/pipeline/title-extractor.js";
import { PIIType, SpanMatch, DetectionSource } from "../../src/types/index.js";

describe("Title Extractor", () => {
  describe("extractTitle", () => {
    describe("English titles", () => {
      it("should extract Mr.", () => {
        const result = extractTitle("Mr. John Smith");
        expect(result.title).toBe("Mr.");
        expect(result.nameWithoutTitle).toBe("John Smith");
      });

      it("should extract Mrs.", () => {
        const result = extractTitle("Mrs. Jane Doe");
        expect(result.title).toBe("Mrs.");
        expect(result.nameWithoutTitle).toBe("Jane Doe");
      });

      it("should extract Dr.", () => {
        const result = extractTitle("Dr. Sarah Connor");
        expect(result.title).toBe("Dr.");
        expect(result.nameWithoutTitle).toBe("Sarah Connor");
      });

      it("should extract Professor", () => {
        const result = extractTitle("Professor Albert Einstein");
        expect(result.title).toBe("Professor");
        expect(result.nameWithoutTitle).toBe("Albert Einstein");
      });

      it("should extract Sir", () => {
        const result = extractTitle("Sir Isaac Newton");
        expect(result.title).toBe("Sir");
        expect(result.nameWithoutTitle).toBe("Isaac Newton");
      });

      it("should extract military titles", () => {
        expect(extractTitle("Captain James Kirk").title).toBe("Captain");
        expect(extractTitle("Col. Sanders").title).toBe("Col.");
        expect(extractTitle("General Patton").title).toBe("General");
      });
    });

    describe("German titles", () => {
      it("should extract Herr", () => {
        const result = extractTitle("Herr Schmidt");
        expect(result.title).toBe("Herr");
        expect(result.nameWithoutTitle).toBe("Schmidt");
      });

      it("should extract Frau", () => {
        const result = extractTitle("Frau Müller");
        expect(result.title).toBe("Frau");
        expect(result.nameWithoutTitle).toBe("Müller");
      });

      it("should extract Prof. Dr.", () => {
        const result = extractTitle("Prof. Dr. Weber");
        expect(result.title).toBe("Prof. Dr.");
        expect(result.nameWithoutTitle).toBe("Weber");
      });
    });

    describe("French titles", () => {
      it("should extract M.", () => {
        const result = extractTitle("M. Dupont");
        expect(result.title).toBe("M.");
        expect(result.nameWithoutTitle).toBe("Dupont");
      });

      it("should extract Mme", () => {
        const result = extractTitle("Mme Laurent");
        expect(result.title).toBe("Mme");
        expect(result.nameWithoutTitle).toBe("Laurent");
      });

      it("should extract Maître", () => {
        const result = extractTitle("Maître Dubois");
        expect(result.title).toBe("Maître");
        expect(result.nameWithoutTitle).toBe("Dubois");
      });
    });

    describe("Spanish titles", () => {
      it("should extract Sr.", () => {
        const result = extractTitle("Sr. García");
        expect(result.title).toBe("Sr.");
        expect(result.nameWithoutTitle).toBe("García");
      });

      it("should extract Don", () => {
        const result = extractTitle("Don Quixote");
        expect(result.title).toBe("Don");
        expect(result.nameWithoutTitle).toBe("Quixote");
      });
    });

    describe("Italian titles", () => {
      it("should extract Sig.", () => {
        const result = extractTitle("Sig. Rossi");
        expect(result.title).toBe("Sig.");
        expect(result.nameWithoutTitle).toBe("Rossi");
      });

      it("should extract Dott.", () => {
        const result = extractTitle("Dott. Bianchi");
        expect(result.title).toBe("Dott.");
        expect(result.nameWithoutTitle).toBe("Bianchi");
      });
    });

    describe("Chinese titles", () => {
      it("should extract 先生", () => {
        const result = extractTitle("先生 王");
        expect(result.title).toBe("先生");
        expect(result.nameWithoutTitle).toBe("王");
      });

      it("should extract 博士", () => {
        const result = extractTitle("博士 李明");
        expect(result.title).toBe("博士");
        expect(result.nameWithoutTitle).toBe("李明");
      });
    });

    describe("Arabic titles", () => {
      it("should extract الدكتور", () => {
        const result = extractTitle("الدكتور أحمد");
        expect(result.title).toBe("الدكتور");
        expect(result.nameWithoutTitle).toBe("أحمد");
      });

      it("should extract Sheikh", () => {
        const result = extractTitle("Sheikh Mohammed");
        expect(result.title).toBe("Sheikh");
        expect(result.nameWithoutTitle).toBe("Mohammed");
      });
    });

    describe("edge cases", () => {
      it("should return no title for names without titles", () => {
        const result = extractTitle("John Smith");
        expect(result.title).toBeUndefined();
        expect(result.nameWithoutTitle).toBe("John Smith");
        expect(result.titleLength).toBe(0);
      });

      it("should be case-insensitive", () => {
        expect(extractTitle("DR. Smith").title).toBe("DR.");
        expect(extractTitle("mr. Jones").title).toBe("mr.");
        expect(extractTitle("PROFESSOR Brown").title).toBe("PROFESSOR");
      });

      it("should not extract title if only title remains", () => {
        const result = extractTitle("Dr.");
        expect(result.title).toBeUndefined();
        expect(result.nameWithoutTitle).toBe("Dr.");
      });

      it("should handle extra whitespace", () => {
        const result = extractTitle("  Dr.  John Smith  ");
        expect(result.title).toBe("Dr.");
        expect(result.nameWithoutTitle).toBe("John Smith");
      });
    });
  });

  describe("extractTitlesFromSpans", () => {
    it("should extract title from PERSON span and adjust boundaries", () => {
      const text = "Hello Dr. John Smith from Berlin!";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6, // "Dr. John Smith"
          end: 20,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Dr. John Smith",
        },
      ];

      const result = extractTitlesFromSpans(spans, text);

      expect(result[0]?.text).toBe("John Smith");
      expect(result[0]?.start).toBe(10); // After "Dr. "
      expect(result[0]?.semantic?.title).toBe("Dr.");
    });

    it("should not modify non-PERSON spans", () => {
      const text = "Contact us at Dr. Evil Corp";
      const spans: SpanMatch[] = [
        {
          type: PIIType.ORG,
          start: 14,
          end: 27,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Dr. Evil Corp",
        },
      ];

      const result = extractTitlesFromSpans(spans, text);

      expect(result[0]?.text).toBe("Dr. Evil Corp");
      expect(result[0]?.start).toBe(14);
    });

    it("should not modify PERSON spans without titles", () => {
      const text = "Hello John Smith!";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6,
          end: 16,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "John Smith",
        },
      ];

      const result = extractTitlesFromSpans(spans, text);

      expect(result[0]?.text).toBe("John Smith");
      expect(result[0]?.start).toBe(6);
      expect(result[0]?.semantic?.title).toBeUndefined();
    });

    it("should handle multiple spans", () => {
      const text = "Meeting with Dr. Smith and Mrs. Jones";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 13,
          end: 22,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Dr. Smith",
        },
        {
          type: PIIType.PERSON,
          start: 27,
          end: 37,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Mrs. Jones",
        },
      ];

      const result = extractTitlesFromSpans(spans, text);

      expect(result[0]?.text).toBe("Smith");
      expect(result[0]?.semantic?.title).toBe("Dr.");
      expect(result[1]?.text).toBe("Jones");
      expect(result[1]?.semantic?.title).toBe("Mrs.");
    });
  });

  describe("utility functions", () => {
    describe("getTitlesForLanguage", () => {
      it("should return English titles", () => {
        const titles = getTitlesForLanguage("en");
        expect(titles).toContain("Mr.");
        expect(titles).toContain("Mrs.");
        expect(titles).toContain("Dr.");
      });

      it("should return German titles", () => {
        const titles = getTitlesForLanguage("de");
        expect(titles).toContain("Herr");
        expect(titles).toContain("Frau");
      });

      it("should return Chinese titles", () => {
        const titles = getTitlesForLanguage("zh");
        expect(titles).toContain("先生");
        expect(titles).toContain("博士");
      });
    });

    describe("getAllTitles", () => {
      it("should return all titles sorted by length", () => {
        const titles = getAllTitles();
        expect(titles.length).toBeGreaterThan(100);

        // Should be sorted by length (longest first)
        for (let i = 1; i < titles.length; i++) {
          expect(titles[i - 1]!.length).toBeGreaterThanOrEqual(
            titles[i]!.length
          );
        }
      });
    });

    describe("startsWithTitle", () => {
      it("should return true for names starting with titles", () => {
        expect(startsWithTitle("Dr. Smith")).toBe(true);
        expect(startsWithTitle("Herr Müller")).toBe(true);
        expect(startsWithTitle("先生 王")).toBe(true);
      });

      it("should return false for names without titles", () => {
        expect(startsWithTitle("John Smith")).toBe(false);
        expect(startsWithTitle("Maria Garcia")).toBe(false);
      });
    });

    describe("isOnlyTitle", () => {
      it("should return true for text that is only a title", () => {
        expect(isOnlyTitle("Mrs")).toBe(true);
        expect(isOnlyTitle("Mrs.")).toBe(true);
        expect(isOnlyTitle("Dr")).toBe(true);
        expect(isOnlyTitle("Dr.")).toBe(true);
        expect(isOnlyTitle("Professor")).toBe(true);
        expect(isOnlyTitle("Herr")).toBe(true);
        expect(isOnlyTitle("先生")).toBe(true);
      });

      it("should return false for text with name after title", () => {
        expect(isOnlyTitle("Mrs. Smith")).toBe(false);
        expect(isOnlyTitle("Dr. John")).toBe(false);
        expect(isOnlyTitle("Professor Einstein")).toBe(false);
      });

      it("should return false for regular names", () => {
        expect(isOnlyTitle("John")).toBe(false);
        expect(isOnlyTitle("Smith")).toBe(false);
      });
    });
  });

  describe("mergeAdjacentTitleSpans", () => {
    it("should merge 'Mrs.' and 'Smith' when split by NER", () => {
      const text = "Hello Mrs. Smith from Berlin!";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6,
          end: 10, // "Mrs."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Mrs.",
        },
        {
          type: PIIType.PERSON,
          start: 11,
          end: 16, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      expect(result.length).toBe(1);
      expect(result[0]?.text).toBe("Mrs. Smith");
      expect(result[0]?.start).toBe(6);
      expect(result[0]?.end).toBe(16);
      expect(result[0]?.confidence).toBe(0.9); // Higher confidence
    });

    it("should merge 'Dr' and 'Jones' when separated by period and space", () => {
      const text = "Contact Dr. Jones please.";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 8,
          end: 10, // "Dr"
          confidence: 0.7,
          source: DetectionSource.NER,
          text: "Dr",
        },
        {
          type: PIIType.PERSON,
          start: 12,
          end: 17, // "Jones"
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "Jones",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      expect(result.length).toBe(1);
      expect(result[0]?.text).toBe("Dr. Jones");
    });

    it("should not merge non-adjacent spans", () => {
      const text = "Mrs. Smith and Dr. Jones";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4, // "Mrs."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Mrs.",
        },
        {
          type: PIIType.PERSON,
          start: 15,
          end: 24, // "Dr. Jones"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Dr. Jones",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      // First should not merge (no adjacent PERSON)
      // Second is already complete
      expect(result.length).toBe(2);
    });

    it("should not merge spans of different types", () => {
      const text = "Mrs. Acme Corp";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4, // "Mrs."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Mrs.",
        },
        {
          type: PIIType.ORG,
          start: 5,
          end: 14, // "Acme Corp"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Acme Corp",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      expect(result.length).toBe(2);
      expect(result[0]?.type).toBe(PIIType.PERSON);
      expect(result[1]?.type).toBe(PIIType.ORG);
    });

    it("should not merge when first span is not a title", () => {
      const text = "John Smith";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4, // "John"
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "John",
        },
        {
          type: PIIType.PERSON,
          start: 5,
          end: 10, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      // Should not merge regular names
      expect(result.length).toBe(2);
    });

    it("should handle multiple title merges in same text", () => {
      const text = "Meeting with Dr. Smith and Mrs. Jones";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 13,
          end: 16, // "Dr."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Dr.",
        },
        {
          type: PIIType.PERSON,
          start: 17,
          end: 22, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
        },
        {
          type: PIIType.PERSON,
          start: 27,
          end: 31, // "Mrs."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Mrs.",
        },
        {
          type: PIIType.PERSON,
          start: 32,
          end: 37, // "Jones"
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "Jones",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      expect(result.length).toBe(2);
      expect(result[0]?.text).toBe("Dr. Smith");
      expect(result[1]?.text).toBe("Mrs. Jones");
    });

    it("should not merge when gap contains non-whitespace characters", () => {
      const text = "Dr.XXSmith";  // Non-whitespace in gap
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 3, // "Dr."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Dr.",
        },
        {
          type: PIIType.PERSON,
          start: 5,
          end: 10, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      // Should not merge due to non-whitespace gap
      expect(result.length).toBe(2);
    });

    it("should not merge when gap is too large", () => {
      const text = "Dr.                           Smith";  // Large gap
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 3, // "Dr."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Dr.",
        },
        {
          type: PIIType.PERSON,
          start: 30,
          end: 35, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      // Should not merge due to large gap
      expect(result.length).toBe(2);
    });

    it("should preserve semantic attributes when merging", () => {
      const text = "Hello Dr. Smith";
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 6,
          end: 9, // "Dr."
          confidence: 0.8,
          source: DetectionSource.NER,
          text: "Dr.",
          semantic: { title: "Dr." },
        },
        {
          type: PIIType.PERSON,
          start: 10,
          end: 15, // "Smith"
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Smith",
          semantic: { gender: "male" },
        },
      ];

      const result = mergeAdjacentTitleSpans(spans, text);

      expect(result.length).toBe(1);
      expect(result[0]?.semantic?.gender).toBe("male");
    });
  });
});
