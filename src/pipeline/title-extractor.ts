/**
 * Title Extractor
 * Extracts and strips honorific titles/prefixes from PERSON entities
 * so that titles remain visible in anonymized text for translation.
 *
 * Supported languages: ar, de, en, es, fr, it, lv, nl, pt, zh
 */

import {
  SpanMatch,
  PIIType,
  SemanticAttributes,
  DetectionSource,
} from "../types/index.js";

/**
 * Title extraction result
 */
export interface TitleExtractionResult {
  /** The extracted title (e.g., "Dr.", "Mr.") or undefined if no title */
  title?: string;
  /** The name without the title */
  nameWithoutTitle: string;
  /** Character offset where the name starts (after title + space) */
  titleLength: number;
}

/**
 * Comprehensive list of honorific titles by language
 * Organized by language code, then by category
 *
 * Each pattern includes:
 * - The title text (case-insensitive matching)
 * - Whether it requires a period (for abbreviations)
 * - Common variants
 */

// English titles
const EN_TITLES = [
  // Basic honorifics
  "Mr",
  "Mr.",
  "Mister",
  "Mrs",
  "Mrs.",
  "Missus",
  "Ms",
  "Ms.",
  "Miss",
  "Mx",
  "Mx.", // Gender-neutral
  // Professional/Academic
  "Dr",
  "Dr.",
  "Doctor",
  "Prof",
  "Prof.",
  "Professor",
  "Rev",
  "Rev.",
  "Reverend",
  "Fr",
  "Fr.",
  "Father",
  "Sr",
  "Sr.",
  "Sister",
  "Br",
  "Br.",
  "Brother",
  // Military
  "Capt",
  "Capt.",
  "Captain",
  "Col",
  "Col.",
  "Colonel",
  "Gen",
  "Gen.",
  "General",
  "Lt",
  "Lt.",
  "Lieutenant",
  "Sgt",
  "Sgt.",
  "Sergeant",
  "Maj",
  "Maj.",
  "Major",
  "Cpl",
  "Cpl.",
  "Corporal",
  "Pvt",
  "Pvt.",
  "Private",
  "Adm",
  "Adm.",
  "Admiral",
  "Cmdr",
  "Cmdr.",
  "Commander",
  // Nobility/Honorific
  "Sir",
  "Dame",
  "Lord",
  "Lady",
  "Hon",
  "Hon.",
  "Honorable",
  "The Honorable",
  "Rt Hon",
  "Rt. Hon.",
  "Right Honorable",
  "The Right Honorable",
  // Legal
  "Esq",
  "Esq.",
  "Esquire",
  "Atty",
  "Atty.",
  "Attorney",
  "Judge",
  "Justice",
];

// German titles
const DE_TITLES = [
  // Basic honorifics
  "Herr",
  "Frau",
  "Fräulein",
  // Professional/Academic
  "Dr",
  "Dr.",
  "Doktor",
  "Prof",
  "Prof.",
  "Professor",
  "Mag",
  "Mag.",
  "Magister",
  "Dipl",
  "Dipl.",
  "Diplom",
  "Dipl.-Ing",
  "Dipl.-Ing.",
  "Diplomingenieur",
  "Ing",
  "Ing.",
  "Ingenieur",
  // Combinations common in German-speaking countries
  "Dr. med",
  "Dr. med.",
  "Dr. jur",
  "Dr. jur.",
  "Dr. phil",
  "Dr. phil.",
  "Dr. rer. nat",
  "Dr. rer. nat.",
  "Dr. h.c",
  "Dr. h.c.",
  "Prof. Dr",
  "Prof. Dr.",
  // Military/Official
  "Gen",
  "Gen.",
  "General",
  "Oberst",
  "Major",
  "Hauptmann",
  // Religious
  "Pfarrer",
  "Pastor",
  "Bischof",
];

// French titles
const FR_TITLES = [
  // Basic honorifics
  "M",
  "M.",
  "Monsieur",
  "Mme",
  "Mme.",
  "Madame",
  "Mlle",
  "Mlle.",
  "Mademoiselle",
  // Professional
  "Dr",
  "Dr.",
  "Docteur",
  "Pr",
  "Pr.",
  "Professeur",
  "Prof",
  "Prof.",
  "Me",
  "Me.",
  "Maître",
  "Maitre", // For lawyers/notaries
  "Mgr",
  "Mgr.",
  "Monseigneur",
  // Military
  "Gén",
  "Gén.",
  "Général",
  "Gen",
  "Gen.",
  "Col",
  "Col.",
  "Colonel",
  "Cdt",
  "Cdt.",
  "Commandant",
  "Capt",
  "Capt.",
  "Capitaine",
  "Lt",
  "Lt.",
  "Lieutenant",
  // Religious
  "Père",
  "Frère",
  "Sœur",
  "Soeur",
  "Abbé",
];

// Spanish titles
const ES_TITLES = [
  // Basic honorifics
  "Sr",
  "Sr.",
  "Señor",
  "Sra",
  "Sra.",
  "Señora",
  "Srta",
  "Srta.",
  "Señorita",
  // Traditional
  "Don",
  "Doña",
  "D.",
  "Dña.",
  // Professional
  "Dr",
  "Dr.",
  "Doctor",
  "Dra",
  "Dra.",
  "Doctora",
  "Prof",
  "Prof.",
  "Profesor",
  "Profa",
  "Profa.",
  "Profesora",
  "Lic",
  "Lic.",
  "Licenciado",
  "Licenciada",
  "Ing",
  "Ing.",
  "Ingeniero",
  "Ingeniera",
  "Arq",
  "Arq.",
  "Arquitecto",
  "Arquitecta",
  "Abog",
  "Abog.",
  "Abogado",
  "Abogada",
  // Military
  "Gral",
  "Gral.",
  "General",
  "Cnel",
  "Cnel.",
  "Coronel",
  "Cap",
  "Cap.",
  "Capitán",
  "Tte",
  "Tte.",
  "Teniente",
  // Religious
  "Padre",
  "Fray",
  "Sor",
];

// Italian titles
const IT_TITLES = [
  // Basic honorifics
  "Sig",
  "Sig.",
  "Signor",
  "Signore",
  "Sig.ra",
  "Signora",
  "Sig.na",
  "Signorina",
  // Professional
  "Dott",
  "Dott.",
  "Dottore",
  "Dottor",
  "Dott.ssa",
  "Dottoressa",
  "Prof",
  "Prof.",
  "Professore",
  "Professor",
  "Prof.ssa",
  "Professoressa",
  "Ing",
  "Ing.",
  "Ingegnere",
  "Avv",
  "Avv.",
  "Avvocato",
  "Arch",
  "Arch.",
  "Architetto",
  "Rag",
  "Rag.",
  "Ragioniere",
  "Geom",
  "Geom.",
  "Geometra",
  // Nobility
  "Conte",
  "Contessa",
  "Marchese",
  "Marchesa",
  "Principe",
  "Principessa",
  "Duca",
  "Duchessa",
  // Religious
  "Don",
  "Padre",
  "Fra",
  "Suor",
  "Mons",
  "Mons.",
  "Monsignore",
];

// Portuguese titles
const PT_TITLES = [
  // Basic honorifics
  "Sr",
  "Sr.",
  "Senhor",
  "Sra",
  "Sra.",
  "Senhora",
  "Srta",
  "Srta.",
  "Senhorita",
  // Professional
  "Dr",
  "Dr.",
  "Doutor",
  "Dra",
  "Dra.",
  "Doutora",
  "Prof",
  "Prof.",
  "Professor",
  "Profa",
  "Profa.",
  "Professora",
  "Eng",
  "Eng.",
  "Engenheiro",
  "Engenheira",
  "Arq",
  "Arq.",
  "Arquiteto",
  "Arquiteta",
  // Traditional (Brazil/Portugal)
  "Dom",
  "Dona",
  // Military
  "Gen",
  "Gen.",
  "General",
  "Cel",
  "Cel.",
  "Coronel",
  "Cap",
  "Cap.",
  "Capitão",
  "Ten",
  "Ten.",
  "Tenente",
  // Religious
  "Padre",
  "Frei",
  "Irmã",
  "Irmão",
];

// Dutch titles
const NL_TITLES = [
  // Basic honorifics
  "Dhr",
  "Dhr.",
  "De heer",
  "Meneer",
  "Mijnheer",
  "Mevr",
  "Mevr.",
  "Mevrouw",
  "Mw",
  "Mw.",
  "Mejuffrouw",
  "Juffrouw",
  // Professional/Academic
  "Dr",
  "Dr.",
  "Doctor",
  "Prof",
  "Prof.",
  "Professor",
  "Ir",
  "Ir.",
  "Ingenieur",
  "Mr",
  "Mr.",
  "Meester", // Legal title
  "Drs",
  "Drs.",
  "Doctorandus",
  "Ing",
  "Ing.",
  // Military
  "Gen",
  "Gen.",
  "Generaal",
  "Kol",
  "Kol.",
  "Kolonel",
  "Kapt",
  "Kapt.",
  "Kapitein",
  // Religious
  "Ds",
  "Ds.",
  "Dominee",
  "Pastoor",
  "Pater",
];

// Latvian titles
const LV_TITLES = [
  // Basic honorifics
  "kungs",
  "kundze",
  "jaunkundze",
  "k-gs",
  "k-dze",
  // Professional
  "Dr",
  "Dr.",
  "doktors",
  "Prof",
  "Prof.",
  "profesors",
  // Note: Latvian uses fewer abbreviated titles than Western languages
];

// Arabic titles (transliterated and Arabic script)
const AR_TITLES = [
  // Basic honorifics - Arabic script
  "السيد",
  "السيدة",
  "الآنسة",
  // Basic honorifics - transliterated
  "Al-Sayyid",
  "As-Sayyid",
  "Sayyid",
  "Al-Sayyida",
  "As-Sayyida",
  "Sayyida",
  "Al-Aanisa",
  "Aanisa",
  // Professional - Arabic script
  "الدكتور",
  "الدكتورة",
  "الأستاذ",
  "الأستاذة",
  "المهندس",
  "المهندسة",
  // Professional - transliterated
  "Dr",
  "Dr.",
  "Doktor",
  "Ustadh",
  "Ustadha",
  "Ustaaz",
  "Muhandis",
  "Muhandisa",
  // Religious
  "الشيخ",
  "Sheikh",
  "Shaikh",
  "Shaykh",
  "الإمام",
  "Imam",
  "الحاج",
  "Hajj",
  "Hajji",
  "Al-Hajj",
  // Nobility/Honorific
  "أمير",
  "Amir",
  "Emir",
  "سلطان",
  "Sultan",
];

// Chinese titles (simplified and traditional)
const ZH_TITLES = [
  // Basic honorifics
  "先生", // xiānsheng - Mr.
  "女士", // nǚshì - Ms.
  "小姐", // xiǎojiě - Miss
  "太太", // tàitai - Mrs.
  // Professional/Academic
  "博士", // bóshì - Doctor (PhD)
  "教授", // jiàoshòu - Professor
  "医生", // yīshēng - Doctor (medical)
  "老师",
  "老師", // lǎoshī - Teacher
  "工程师",
  "工程師", // gōngchéngshī - Engineer
  "律师",
  "律師", // lǜshī - Lawyer
  // Military
  "将军",
  "將軍", // jiāngjūn - General
  "上校", // shàngxiào - Colonel
  "上尉", // shàngwèi - Captain
  // Traditional/Formal
  "阁下",
  "閣下", // géxià - Your Excellency
  "大人", // dàrén - Lord/Sir (historical)
];

/**
 * All titles combined and sorted by length (longest first)
 * This ensures "Prof. Dr." matches before "Prof."
 */
const ALL_TITLES: string[] = [
  ...EN_TITLES,
  ...DE_TITLES,
  ...FR_TITLES,
  ...ES_TITLES,
  ...IT_TITLES,
  ...PT_TITLES,
  ...NL_TITLES,
  ...LV_TITLES,
  ...AR_TITLES,
  ...ZH_TITLES,
].sort((a, b) => b.length - a.length);

/**
 * Pre-compiled regex patterns for title matching
 * Matches title at start of string, followed by whitespace
 */
const TITLE_PATTERNS: Array<{ pattern: RegExp; title: string }> =
  ALL_TITLES.map((title) => ({
    pattern: new RegExp(`^${escapeRegex(title)}(?:\\s+|$)`, "i"),
    title,
  }));

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts a title from the beginning of a name
 *
 * @param name - Full name potentially starting with a title
 * @returns Extraction result with title, remaining name, and offset
 *
 * @example
 * extractTitle("Dr. John Smith") // { title: "Dr.", nameWithoutTitle: "John Smith", titleLength: 4 }
 * extractTitle("John Smith") // { title: undefined, nameWithoutTitle: "John Smith", titleLength: 0 }
 */
export function extractTitle(name: string): TitleExtractionResult {
  const trimmed = name.trim();

  for (const { pattern } of TITLE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match !== null) {
      const matchedText = match[0];
      const nameWithoutTitle = trimmed.slice(matchedText.length).trim();

      // Only extract if there's still a name left after the title
      if (nameWithoutTitle.length > 0) {
        return {
          title: matchedText.trimEnd(), // Keep original case from input
          nameWithoutTitle,
          titleLength: matchedText.length,
        };
      }
    }
  }

  return {
    title: undefined,
    nameWithoutTitle: trimmed,
    titleLength: 0,
  };
}

/**
 * Extended semantic attributes including title
 */
export interface SemanticAttributesWithTitle extends SemanticAttributes {
  /** Extracted title prefix (e.g., "Dr.", "Mrs.") */
  title?: string;
}

/**
 * Processes PERSON spans to extract titles
 * Titles are removed from the span and stored in semantic attributes
 * The span boundaries are adjusted so the title remains visible
 *
 * @param spans - Array of detected PII spans
 * @param originalText - The original text (needed to verify span boundaries)
 * @returns Array of spans with titles extracted from PERSON entities
 */
export function extractTitlesFromSpans(
  spans: SpanMatch[],
  originalText: string
): SpanMatch[] {
  return spans.map((span) => {
    // Only process PERSON entities
    if (span.type !== PIIType.PERSON) {
      return span;
    }

    // Get the actual text from the span
    const spanText = span.text;
    const extraction = extractTitle(spanText);

    // If no title found, return original span
    if (extraction.title === undefined || extraction.titleLength === 0) {
      return span;
    }

    // Verify the extraction makes sense (remaining name is not empty)
    if (extraction.nameWithoutTitle.length === 0) {
      return span;
    }

    // Calculate new span boundaries
    // The title stays in the text, we adjust the span to exclude it
    const newStart = span.start + extraction.titleLength;

    // Make sure new start doesn't exceed original end
    if (newStart >= span.end) {
      return span;
    }

    // Verify the text at the new position matches what we expect
    const expectedText = originalText.slice(newStart, span.end).trim();
    if (
      expectedText.toLowerCase() !== extraction.nameWithoutTitle.toLowerCase()
    ) {
      // Text doesn't match - might be whitespace differences, try to find actual start
      const actualStart = originalText.indexOf(
        extraction.nameWithoutTitle,
        span.start
      );
      if (actualStart === -1 || actualStart >= span.end) {
        return span; // Can't find the name without title, return original
      }
      return {
        ...span,
        start: actualStart,
        text: extraction.nameWithoutTitle,
        semantic: {
          ...span.semantic,
          title: extraction.title,
        } as SemanticAttributesWithTitle,
      };
    }

    // Return new span with adjusted boundaries and title in semantic attributes
    return {
      ...span,
      start: newStart,
      text: extraction.nameWithoutTitle,
      semantic: {
        ...span.semantic,
        title: extraction.title,
      } as SemanticAttributesWithTitle,
    };
  });
}

/**
 * Gets all supported titles for a specific language
 */
export function getTitlesForLanguage(
  langCode: "ar" | "de" | "en" | "es" | "fr" | "it" | "lv" | "nl" | "pt" | "zh"
): string[] {
  const titleMap: Record<string, string[]> = {
    ar: AR_TITLES,
    de: DE_TITLES,
    en: EN_TITLES,
    es: ES_TITLES,
    fr: FR_TITLES,
    it: IT_TITLES,
    lv: LV_TITLES,
    nl: NL_TITLES,
    pt: PT_TITLES,
    zh: ZH_TITLES,
  };
  return titleMap[langCode] ?? [];
}

/**
 * Gets all supported titles across all languages
 */
export function getAllTitles(): string[] {
  return [...ALL_TITLES];
}

/**
 * Checks if a string starts with a known title
 */
export function startsWithTitle(text: string): boolean {
  const result = extractTitle(text);
  return result.title !== undefined;
}

/**
 * Checks if a text consists entirely of a title (with optional punctuation)
 */
export function isOnlyTitle(text: string): boolean {
  const trimmed = text.trim();
  // Remove trailing punctuation for comparison
  const withoutPunctuation = trimmed.replace(/[.,!?;:]+$/, "").trim();

  for (const { pattern } of TITLE_PATTERNS) {
    // Check if the text matches the title pattern completely
    const match = withoutPunctuation.match(pattern);
    if (match !== null) {
      const remaining = withoutPunctuation.slice(match[0].length).trim();
      // If nothing left after the title, it's only a title
      if (remaining === "") {
        return true;
      }
    }
  }

  // Also check for exact match (case-insensitive)
  const normalizedText = withoutPunctuation.toLowerCase();
  for (const title of ALL_TITLES) {
    if (normalizedText === title.toLowerCase()) {
      return true;
    }
  }

  return false;
}

/**
 * Merges adjacent PERSON spans when one is a title
 *
 * This fixes issues where NER models split "Mrs. Smith" into two entities:
 * - PERSON: "Mrs" (or "Mrs.")
 * - PERSON: "Smith"
 *
 * After merging: PERSON: "Mrs. Smith"
 *
 * @param spans - Array of detected PII spans
 * @param originalText - The original text
 * @param maxGap - Maximum characters between spans to consider them adjacent (default: 3)
 * @returns Array of spans with adjacent title+name PERSON entities merged
 */
export function mergeAdjacentTitleSpans(
  spans: SpanMatch[],
  originalText: string,
  maxGap: number = 3
): SpanMatch[] {
  if (spans.length <= 1) {
    return spans;
  }

  // Sort by start position
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const result: SpanMatch[] = [];
  let i = 0;

  while (i < sorted.length) {
    const current = sorted[i];
    if (current === undefined) {
      i++;
      continue;
    }

    // Only process PERSON entities
    if (current.type !== PIIType.PERSON) {
      result.push(current);
      i++;
      continue;
    }

    // Check if this span is only a title
    if (!isOnlyTitle(current.text)) {
      result.push(current);
      i++;
      continue;
    }

    // Look for the next PERSON span that's close enough
    let merged = false;
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next === undefined) continue;

      // Calculate gap between spans
      const gap = next.start - current.end;

      // If gap is too large, stop looking
      if (gap > maxGap) {
        break;
      }

      // Check what's in the gap (should be whitespace/punctuation only)
      const gapText = originalText.slice(current.end, next.start);
      if (!/^[\s.,;:!?]*$/.test(gapText)) {
        break;
      }

      // If next is also PERSON, merge them
      if (next.type === PIIType.PERSON) {
        const mergedText = originalText.slice(current.start, next.end);
        const mergedSpan: SpanMatch = {
          type: PIIType.PERSON,
          start: current.start,
          end: next.end,
          // Use the higher confidence
          confidence: Math.max(current.confidence, next.confidence),
          // Mark as hybrid since we merged NER results
          source:
            current.source === next.source
              ? current.source
              : DetectionSource.HYBRID,
          text: mergedText,
          // Preserve any existing semantic attributes from either span
          semantic: {
            ...current.semantic,
            ...next.semantic,
          },
        };

        result.push(mergedSpan);
        merged = true;
        i = j + 1; // Skip the merged span
        break;
      }
    }

    if (!merged) {
      result.push(current);
      i++;
    }
  }

  return result;
}
