import {
  createAnonymizer,
  type AnonymizerConfig,
  type NERConfig,
  PIIType,
  mergePolicy,
  generateKey,
  uint8ArrayToBase64,
  ConfigKeyProvider,
} from "../../index.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { readInput, writeOutput } from "../utils/io.js";
import { formatText, formatJson, formatNdjson, formatStats } from "../utils/format.js";
import { savePIIMapFile, type PIIMapFile } from "../utils/pii-map-file.js";

function parseTypes(typesStr: string): Set<PIIType> {
  const allValues = new Set(Object.values(PIIType) as string[]);
  const types = new Set<PIIType>();

  for (const raw of typesStr.split(",")) {
    const t = raw.trim().toUpperCase();
    if (t === "") continue;
    if (!allValues.has(t)) {
      throw new CLIError(
        `Unknown PII type: ${raw.trim()}\nValid types: ${[...allValues].join(", ")}`,
      );
    }
    types.add(t as PIIType);
  }

  if (types.size === 0) {
    throw new CLIError("--types must specify at least one PII type");
  }

  return types;
}

function validateNerMode(mode: string): NERConfig["mode"] {
  const valid = ["disabled", "quantized", "standard"];
  if (!valid.includes(mode)) {
    throw new CLIError(
      `Invalid NER mode: ${mode}\nValid modes: ${valid.join(", ")}`,
    );
  }
  return mode as NERConfig["mode"];
}

function validateMode(mode: string): "anonymize" | "pseudonymize" {
  if (mode !== "anonymize" && mode !== "pseudonymize") {
    throw new CLIError(
      `Invalid mode: ${mode}\nValid modes: anonymize, pseudonymize`,
    );
  }
  return mode;
}

function validateFormat(format: string): "text" | "json" | "ndjson" {
  if (format !== "text" && format !== "json" && format !== "ndjson") {
    throw new CLIError(
      `Invalid format: ${format}\nValid formats: text, json, ndjson`,
    );
  }
  return format;
}

export async function anonymizeCommand(
  filePath: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  const nerMode = validateNerMode(options.ner);
  const anonMode = validateMode(options.mode);
  const format = validateFormat(options.format);

  const input = await readInput(filePath);

  // Set up encryption key
  const envKey = process.env["REHYDRA_KEY"];
  const flagKey = options.key;
  const externalKey = flagKey ?? envKey;

  let keyBase64: string | undefined;
  let keyProvider: ConfigKeyProvider;

  if (externalKey !== undefined) {
    keyProvider = new ConfigKeyProvider(externalKey);
    // Don't store the key in the PII map file when user provides it
  } else {
    const keyBytes = generateKey();
    keyBase64 = uint8ArrayToBase64(keyBytes);
    keyProvider = new ConfigKeyProvider(keyBase64);
  }

  // Build anonymizer config
  const config: AnonymizerConfig = {
    mode: anonMode,
    keyProvider,
  };

  if (nerMode !== "disabled") {
    config.ner = {
      mode: nerMode,
      autoDownload: true,
      onStatus: options.quiet
        ? undefined
        : (status: string): void => {
            process.stderr.write(`${status}\n`);
          },
    };
  }

  // Build policy with type filtering
  const policy = options.types !== undefined
    ? mergePolicy({ enabledTypes: parseTypes(options.types) })
    : undefined;

  const anonymizer = createAnonymizer(config);
  await anonymizer.initialize();

  try {
    const result = await anonymizer.anonymize(input, options.locale, policy !== undefined ? policy : undefined);

    // Save PII map file in pseudonymize mode
    if (anonMode === "pseudonymize" && result.piiMap !== undefined) {
      const piiMapFile: PIIMapFile = {
        version: 1,
        createdAt: new Date().toISOString(),
        ...(keyBase64 !== undefined ? { key: keyBase64 } : {}),
        piiMap: result.piiMap,
        stats: {
          totalEntities: result.stats.totalEntities,
          countsByType: result.stats.countsByType,
        },
      };
      await savePIIMapFile(options["pii-map"], piiMapFile);

      if (!options.quiet) {
        process.stderr.write(
          `PII map saved to ${options["pii-map"]}\n`,
        );
      }
    }

    // Format output
    let output: string;
    switch (format) {
      case "text":
        output = formatText(result);
        break;
      case "json":
        output = formatJson(result);
        break;
      case "ndjson":
        output = formatNdjson(result);
        break;
    }

    // Ensure trailing newline
    if (!output.endsWith("\n")) {
      output += "\n";
    }

    await writeOutput(output, options.output);

    // Print stats to stderr if verbose
    if (options.verbose) {
      process.stderr.write(formatStats(result.stats) + "\n");
    }

    // Exit code 2 if no PII found
    return result.stats.totalEntities > 0 ? 0 : 2;
  } finally {
    await anonymizer.dispose();
  }
}
