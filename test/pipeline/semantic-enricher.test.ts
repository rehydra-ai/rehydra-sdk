import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  enrichSemantics,
  inferGender,
  classifyLocation,
  getDatabaseStats,
  hasName,
  hasLocation,
  isSemanticDataAvailable,
} from "../../src/pipeline/semantic-enricher.js";
import {
  clearSemanticData,
  isSemanticDataDownloaded,
  loadSemanticData,
} from "../../src/pipeline/semantic-data-loader.js";
import { PIIType, SpanMatch, DetectionSource } from "../../src/types/index.js";

describe("Semantic Enricher", () => {
  let dataAvailable = false;

  beforeAll(async () => {
    dataAvailable = await isSemanticDataDownloaded();
    if (!dataAvailable) {
      console.warn(
        "\n⚠️  Semantic data files not found. Skipping semantic enricher tests.\n" +
          "   Use ensureSemanticData() or createAnonymizer({ semantic: { enabled: true } }) to download.\n"
      );
    } else {
      // Pre-load data for synchronous tests
      await loadSemanticData();
    }
  });

  afterAll(() => {
    // Clear loaded data after tests
    clearSemanticData();
  });

  describe("inferGender", () => {
    it("should identify common female names", async () => {
      if (!dataAvailable) return;
      expect(inferGender("Mary").gender).toBe("female");
      expect(inferGender("Sarah").gender).toBe("female");
      expect(inferGender("Emma").gender).toBe("female");
      expect(inferGender("Julia").gender).toBe("female");
    });

    it("should identify common male names", async () => {
      if (!dataAvailable) return;
      expect(inferGender("John").gender).toBe("male");
      expect(inferGender("Michael").gender).toBe("male");
      expect(inferGender("David").gender).toBe("male");
      expect(inferGender("Thomas").gender).toBe("male");
    });

    it("should identify neutral/ambiguous names", async () => {
      if (!dataAvailable) return;
      // These might vary based on data source - checking for non-unknown
      const alex = inferGender("Alex");
      expect(["male", "female", "neutral"]).toContain(alex.gender);
    });

    it("should return unknown for names not in database", async () => {
      if (!dataAvailable) return;
      expect(inferGender("Xyzabc").gender).toBe("unknown");
      expect(inferGender("UnknownName12345").gender).toBe("unknown");
    });

    it("should handle case-insensitive lookup", async () => {
      if (!dataAvailable) return;
      expect(inferGender("MARY").gender).toBe("female");
      expect(inferGender("mary").gender).toBe("female");
      expect(inferGender("Mary").gender).toBe("female");
    });

    it("should extract first name from full name", async () => {
      if (!dataAvailable) return;
      expect(inferGender("John Smith").gender).toBe("male");
      expect(inferGender("Mary Jane Watson").gender).toBe("female");
    });

    it("should handle titles/prefixes", async () => {
      if (!dataAvailable) return;
      expect(inferGender("Dr. John").gender).toBe("male");
      expect(inferGender("Mr. James").gender).toBe("male");
      expect(inferGender("Mrs. Emma").gender).toBe("female");
    });

    it("should return high confidence for known names", async () => {
      if (!dataAvailable) return;
      const result = inferGender("Mary");
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.source).toBe("database");
    });

    it("should return zero confidence for unknown names", async () => {
      if (!dataAvailable) return;
      const result = inferGender("Xyzabc12345");
      expect(result.confidence).toBe(0);
      expect(result.source).toBe("unknown");
    });

    it("should handle empty or whitespace input", async () => {
      if (!dataAvailable) return;
      expect(inferGender("").gender).toBe("unknown");
      expect(inferGender("   ").gender).toBe("unknown");
    });
  });

  describe("classifyLocation", () => {
    describe("cities", () => {
      it("should identify major cities", async () => {
        if (!dataAvailable) return;
        expect(classifyLocation("Berlin").scope).toBe("city");
        expect(classifyLocation("Paris").scope).toBe("city");
        expect(classifyLocation("London").scope).toBe("city");
        expect(classifyLocation("Tokyo").scope).toBe("city");
      });

      it("should return country code for cities", async () => {
        if (!dataAvailable) return;
        const berlin = classifyLocation("Berlin");
        expect(berlin.scope).toBe("city");
        expect(berlin.countryCode).toBe("DE");

        const paris = classifyLocation("Paris");
        expect(paris.scope).toBe("city");
        expect(paris.countryCode).toBe("FR");
      });
    });

    describe("countries", () => {
      it("should identify countries", async () => {
        if (!dataAvailable) return;
        expect(classifyLocation("Germany").scope).toBe("country");
        expect(classifyLocation("France").scope).toBe("country");
        expect(classifyLocation("Japan").scope).toBe("country");
      });

      it("should handle country name variants", async () => {
        if (!dataAvailable) return;
        expect(classifyLocation("Deutschland").scope).toBe("country");
        expect(classifyLocation("USA").scope).toBe("country");
        expect(classifyLocation("UK").scope).toBe("country");
      });

      it("should return country code for countries", async () => {
        if (!dataAvailable) return;
        const germany = classifyLocation("Germany");
        expect(germany.scope).toBe("country");
        expect(germany.countryCode).toBe("DE");
      });
    });

    describe("regions", () => {
      it("should identify regions/states", async () => {
        if (!dataAvailable) return;
        expect(classifyLocation("California").scope).toBe("region");
        expect(classifyLocation("Bavaria").scope).toBe("region");
      });

      it("should return country code for regions", async () => {
        if (!dataAvailable) return;
        const california = classifyLocation("California");
        expect(california.scope).toBe("region");
        expect(california.countryCode).toBe("US");
      });
    });

    it("should handle case-insensitive lookup", async () => {
      if (!dataAvailable) return;
      expect(classifyLocation("berlin").scope).toBe("city");
      expect(classifyLocation("BERLIN").scope).toBe("city");
      expect(classifyLocation("Berlin").scope).toBe("city");
    });

    it("should return unknown for locations not in database", async () => {
      if (!dataAvailable) return;
      expect(classifyLocation("Xyzabc").scope).toBe("unknown");
      expect(classifyLocation("Small Village 12345").scope).toBe("unknown");
    });

    it("should return high confidence for known locations", async () => {
      if (!dataAvailable) return;
      const result = classifyLocation("Berlin");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should return zero confidence for unknown locations", async () => {
      if (!dataAvailable) return;
      const result = classifyLocation("Xyzabc12345");
      expect(result.confidence).toBe(0);
    });
  });

  describe("enrichSemantics", () => {
    it("should enrich PERSON entities with gender", async () => {
      if (!dataAvailable) return;
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Mary",
        },
      ];

      const enriched = enrichSemantics(spans);

      expect(enriched[0]?.semantic?.gender).toBe("female");
    });

    it("should enrich LOCATION entities with scope", async () => {
      if (!dataAvailable) return;
      const spans: SpanMatch[] = [
        {
          type: PIIType.LOCATION,
          start: 0,
          end: 6,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Berlin",
        },
      ];

      const enriched = enrichSemantics(spans);

      expect(enriched[0]?.semantic?.scope).toBe("city");
    });

    it("should enrich multiple entities", async () => {
      if (!dataAvailable) return;
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 0,
          end: 4,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "John",
        },
        {
          type: PIIType.LOCATION,
          start: 10,
          end: 17,
          confidence: 0.9,
          source: DetectionSource.NER,
          text: "Germany",
        },
      ];

      const enriched = enrichSemantics(spans);

      expect(enriched[0]?.semantic?.gender).toBe("male");
      expect(enriched[1]?.semantic?.scope).toBe("country");
    });

    it("should not modify non-PERSON/LOCATION entities", async () => {
      if (!dataAvailable) return;
      const spans: SpanMatch[] = [
        {
          type: PIIType.EMAIL,
          start: 0,
          end: 16,
          confidence: 0.98,
          source: DetectionSource.REGEX,
          text: "test@example.com",
        },
      ];

      const enriched = enrichSemantics(spans);

      expect(enriched[0]?.semantic).toBeUndefined();
    });

    it("should preserve existing span properties", async () => {
      if (!dataAvailable) return;
      const spans: SpanMatch[] = [
        {
          type: PIIType.PERSON,
          start: 5,
          end: 9,
          confidence: 0.85,
          source: DetectionSource.NER,
          text: "John",
        },
      ];

      const enriched = enrichSemantics(spans);

      expect(enriched[0]).toMatchObject({
        type: PIIType.PERSON,
        start: 5,
        end: 9,
        confidence: 0.85,
        source: DetectionSource.NER,
        text: "John",
      });
    });
  });

  describe("utility functions", () => {
    describe("getDatabaseStats", () => {
      it("should return database statistics when loaded", async () => {
        if (!dataAvailable) return;
        // Trigger data load by calling a lookup
        inferGender("Mary");

        const stats = getDatabaseStats();

        expect(stats.names).toBeGreaterThan(0);
        expect(stats.cities).toBeGreaterThan(0);
        expect(stats.countries).toBeGreaterThan(0);
        expect(stats.loaded).toBe(true);
      });
    });

    describe("hasName", () => {
      it("should return true for names in database", async () => {
        if (!dataAvailable) return;
        expect(hasName("Mary")).toBe(true);
        expect(hasName("John")).toBe(true);
      });

      it("should return false for names not in database", async () => {
        if (!dataAvailable) return;
        expect(hasName("Xyzabc12345")).toBe(false);
      });

      it("should handle full names", async () => {
        if (!dataAvailable) return;
        expect(hasName("John Smith")).toBe(true);
      });
    });

    describe("hasLocation", () => {
      it("should return true for locations in database", async () => {
        if (!dataAvailable) return;
        expect(hasLocation("Berlin")).toBe(true);
        expect(hasLocation("Germany")).toBe(true);
      });

      it("should return false for locations not in database", async () => {
        if (!dataAvailable) return;
        expect(hasLocation("Xyzabc12345")).toBe(false);
      });
    });
  });

  describe("when data is not available", () => {
    it("should return unknown for inferGender when data not loaded", () => {
      // Clear any loaded data
      clearSemanticData();

      // This test works regardless of data availability
      // It tests the fallback behavior
      const result = inferGender("Xyzabc12345UnlikelyName");
      expect(result.gender).toBe("unknown");
    });

    it("should return unknown for classifyLocation when data not loaded", () => {
      clearSemanticData();

      const result = classifyLocation("Xyzabc12345UnlikelyLocation");
      expect(result.scope).toBe("unknown");
    });

    it("should return false for hasName when data not available and name unknown", () => {
      clearSemanticData();

      // Unknown name returns false
      expect(hasName("Xyzabc12345UnlikelyName")).toBe(false);
    });

    it("should return false for hasLocation when data not available and location unknown", () => {
      clearSemanticData();

      // Unknown location returns false
      expect(hasLocation("Xyzabc12345UnlikelyLocation")).toBe(false);
    });

    it("should handle empty string in hasName", () => {
      clearSemanticData();
      expect(hasName("")).toBe(false);
    });

    it("should handle empty string in hasLocation", () => {
      clearSemanticData();
      expect(hasLocation("")).toBe(false);
    });
  });
});
