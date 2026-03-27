/**
 * OpenCode Plugin Configuration Types
 */

import type { AnonymizerConfig } from "../core/anonymizer.js";
import type { AnonymizationPolicy, TagFormat } from "../types/index.js";
import type { PIIType } from "../types/pii-types.js";

/** PII type names as strings, for convenience in plugin config */
export type PIITypeName = `${PIIType}`;

/**
 * Configuration options for the Rehydra OpenCode plugin.
 */
export interface RehydraPluginOptions {
  /** .env files to scan for secret values */
  envFiles?: string[];

  /** Explicit values to always redact */
  redactValues?: string[];

  /** Minimum value length to consider as a secret (default: 4) */
  minValueLength?: number;

  /** PII types to disable (default: ["URL", "IP_ADDRESS"]). Pass [] to enable all types. */
  disableTypes?: PIITypeName[];

  /** Locale hint for anonymization */
  locale?: string;

  /** Policy overrides */
  policy?: Partial<AnonymizationPolicy>;

  /** Advanced: full anonymizer config (overrides envFiles/redactValues/minValueLength) */
  anonymizer?: AnonymizerConfig;

  /** Tag format configuration (shorthand — also available via anonymizer.tagFormat) */
  tagFormat?: TagFormat;
}
