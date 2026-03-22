/**
 * OpenCode Plugin Configuration Types
 */

import type { AnonymizerConfig } from "../core/anonymizer.js";
import type { AnonymizationPolicy } from "../types/index.js";

/**
 * Configuration options for the Rehydra OpenCode plugin.
 */
export interface RehydraPluginOptions {
  /** .env files to scan for secret values */
  envFiles?: string[];

  /** Explicit values to always redact */
  redactValues?: string[];

  /** Minimum value length to consider as a secret (default: 8) */
  minValueLength?: number;

  /** Locale hint for anonymization */
  locale?: string;

  /** Policy overrides */
  policy?: Partial<AnonymizationPolicy>;

  /** Advanced: full anonymizer config (overrides envFiles/redactValues/minValueLength) */
  anonymizer?: AnonymizerConfig;
}
