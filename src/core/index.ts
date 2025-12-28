/**
 * Core Module Exports
 * Shared anonymization logic for both browser and Node.js entry points
 */

export {
  Anonymizer,
  createAnonymizer,
  anonymize,
  anonymizeRegexOnly,
  anonymizeWithNER,
  type AnonymizerConfig,
  type NERConfig,
  type PIIStorageProvider,
  type AnonymizerSession,
  type SessionFactory,
  type RawPIIMap,
} from "./anonymizer.js";

