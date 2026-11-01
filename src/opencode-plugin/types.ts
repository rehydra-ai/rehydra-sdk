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
  /** Paths/globs relative to the OpenCode project directory. Defaults to recursive .env discovery.
   * Skips node_modules, .git, and symlinks. Pass [] to disable file loading. */
  envFiles?: string[];

  /** Minimum milliseconds between checks of envFiles for new or changed secrets (default: 2000).
   * Pass false to load them only when the plugin starts. */
  envRefreshInterval?: number | false;

  /** Tools whose arguments keep their placeholders: real values are not restored before they run,
   * and detected values are redacted. `*` matches any characters, e.g. "exa_*".
   * Default: ["webfetch", "websearch", "*image_generate"]. Pass [] to restore real values for every tool. */
  redactTools?: string[];

  /** Explicit values to always redact */
  redactValues?: string[];

  /** Minimum value length to consider as a secret (default: 4) */
  minValueLength?: number;

  /** PII types to disable (default: ["URL", "IP_ADDRESS"]). Pass [] to enable all types. */
  disableTypes?: PIITypeName[];

  /** Locale hint for anonymization */
  locale?: string;

  /** Redact identities found in Git and GitHub CLI output */
  vcsIdentities?: boolean;

  /** Policy overrides */
  policy?: Partial<AnonymizationPolicy>;

  /** Advanced: full anonymizer config (overrides envFiles/redactValues/minValueLength) */
  anonymizer?: AnonymizerConfig;

  /** Tag format configuration (shorthand — also available via anonymizer.tagFormat) */
  tagFormat?: TagFormat;
}
