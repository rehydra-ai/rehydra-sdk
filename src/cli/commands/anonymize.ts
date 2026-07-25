import { pipeline } from "node:stream/promises";
import {
  createAnonymizer,
  type AnonymizerConfig,
  type NERConfig,
  type SecretsConfig,
  type AnonymizationPolicy,
  PIIType,
  mergePolicy,
  generateKey,
  uint8ArrayToBase64,
  ConfigKeyProvider,
} from "../../index.js";
import { SECRET_PII_TYPES } from "../../types/pii-types.js";
import {
  createAnonymizerStream,
  type StreamConfig,
  type StreamChunkEvent,
  type StreamFinishEvent,
} from "../../streaming/index.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { readInput, writeOutput, getInputStream, getOutputStream } from "../utils/io.js";
import { formatText, formatJson, formatNdjson, formatStats } from "../utils/format.js";
import { savePIIMapFile, type PIIMapFile } from "../utils/pii-map-file.js";
import { buildTagFormatFromOptions } from "../utils/tag-format.js";

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

function setupKeyProvider(options: ParsedOptions): {
  keyProvider: ConfigKeyProvider;
  keyBase64: string | undefined;
} {
  const envKey = process.env["REHYDRA_KEY"];
  const flagKey = options.key;
  const externalKey = flagKey ?? envKey;

  if (externalKey !== undefined) {
    return { keyProvider: new ConfigKeyProvider(externalKey), keyBase64: undefined };
  }

  const keyBytes = generateKey();
  const keyBase64 = uint8ArrayToBase64(keyBytes);
  return { keyProvider: new ConfigKeyProvider(keyBase64), keyBase64 };
}

function buildNerConfig(
  nerMode: NERConfig["mode"],
  quiet: boolean,
): NERConfig | undefined {
  if (nerMode === "disabled") return undefined;
  return {
    mode: nerMode,
    autoDownload: true,
    onStatus: quiet
      ? undefined
      : (status: string): void => {
          process.stderr.write(`${status}\n`);
        },
  };
}

function buildSecretsConfig(options: ParsedOptions): SecretsConfig | undefined {
  if (!options.secrets) return undefined;
  return {
    enabled: true,
    envFiles: options["env-file"] !== undefined ? [options["env-file"]] : undefined,
  };
}

export async function anonymizeCommand(
  filePath: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  const nerMode = validateNerMode(options.ner);
  const anonMode = validateMode(options.mode);
  const format = validateFormat(options.format);
  const { keyProvider, keyBase64 } = setupKeyProvider(options);
  let policy: Partial<AnonymizationPolicy> | undefined;
  if (options.types !== undefined) {
    const enabledTypes = parseTypes(options.types);
    const policyPartial: Partial<AnonymizationPolicy> = { enabledTypes };
    // When --secrets is active, include secret types in both enabledTypes
    // and regexEnabledTypes so the policy override doesn't suppress them
    if (options.secrets) {
      const regexEnabledTypes = new Set(enabledTypes);
      for (const t of SECRET_PII_TYPES) {
        enabledTypes.add(t);
        regexEnabledTypes.add(t);
      }
      policyPartial.regexEnabledTypes = regexEnabledTypes;
    }
    policy = mergePolicy(policyPartial);
  }

  // Use streaming for file inputs, batch for stdin
  if (filePath !== undefined) {
    return anonymizeFile(filePath, options, nerMode, anonMode, format, keyProvider, keyBase64, policy);
  }
  return anonymizeBatch(options, nerMode, anonMode, format, keyProvider, keyBase64, policy);
}

/**
 * Batch anonymization for stdin input.
 */
async function anonymizeBatch(
  options: ParsedOptions,
  nerMode: NERConfig["mode"],
  anonMode: "anonymize" | "pseudonymize",
  format: "text" | "json" | "ndjson",
  keyProvider: ConfigKeyProvider,
  keyBase64: string | undefined,
  policy: Partial<AnonymizationPolicy> | undefined,
): Promise<number> {
  const input = await readInput();

  const config: AnonymizerConfig = {
    mode: anonMode,
    keyProvider,
    tagFormat: buildTagFormatFromOptions(options),
  };

  const nerConfig = buildNerConfig(nerMode, options.quiet);
  if (nerConfig !== undefined) {
    config.ner = nerConfig;
  }

  const secretsConfig = buildSecretsConfig(options);
  if (secretsConfig !== undefined) {
    config.secrets = secretsConfig;
  }

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

    return result.stats.totalEntities > 0 ? 0 : 2;
  } finally {
    await anonymizer.dispose();
  }
}

/**
 * Streaming anonymization for file inputs.
 */
async function anonymizeFile(
  filePath: string,
  options: ParsedOptions,
  nerMode: NERConfig["mode"],
  anonMode: "anonymize" | "pseudonymize",
  format: "text" | "json" | "ndjson",
  keyProvider: ConfigKeyProvider,
  keyBase64: string | undefined,
  policy: Partial<AnonymizationPolicy> | undefined,
): Promise<number> {
  const countsByType: Record<string, number> = {};
  const allEntities: { type: string; id: number; confidence: number; source: string; semantic?: unknown }[] = [];
  const textChunks: string[] = [];
  let finishData: StreamFinishEvent | undefined;

  const anonymizerConfig: AnonymizerConfig = {
    mode: anonMode,
    keyProvider,
    tagFormat: buildTagFormatFromOptions(options),
  };

  const nerConfig = buildNerConfig(nerMode, options.quiet);
  if (nerConfig !== undefined) {
    anonymizerConfig.ner = nerConfig;
  }

  const secretsConfig = buildSecretsConfig(options);
  if (secretsConfig !== undefined) {
    anonymizerConfig.secrets = secretsConfig;
  }

  const streamConfig: StreamConfig = {
    anonymizer: anonymizerConfig,
    policy: policy ?? undefined,
    locale: options.locale,
    keyProvider,
    onChunk: (event: StreamChunkEvent) => {
      for (const entity of event.entities) {
        countsByType[entity.type] = (countsByType[entity.type] ?? 0) + 1;
        allEntities.push({
          type: entity.type,
          id: entity.id,
          confidence: entity.confidence,
          source: entity.source,
          ...(entity.semantic !== undefined ? { semantic: entity.semantic } : {}),
        });
      }
    },
    onFinish: (event: StreamFinishEvent) => {
      finishData = event;
    },
  };

  const anonymizerStream = await createAnonymizerStream(streamConfig);
  const inputStream = getInputStream(filePath);
  const outputStream = getOutputStream(options.output);

  if (format === "text") {
    // Direct pipe: input → anonymizer → output
    await pipeline(inputStream, anonymizerStream, outputStream);
    // Add trailing newline if writing to file
    if (options.output !== undefined) {
      outputStream.write("\n");
    }
  } else {
    // For json/ndjson: collect output text, format at end
    anonymizerStream.on("data", (chunk: Buffer | string) => {
      textChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    });
    inputStream.pipe(anonymizerStream);
    await new Promise<void>((resolve, reject) => {
      anonymizerStream.on("end", resolve);
      anonymizerStream.on("error", reject);
      inputStream.on("error", reject);
    });

    let output: string;
    if (format === "json") {
      output = JSON.stringify({
        anonymizedText: textChunks.join(""),
        entities: allEntities,
        stats: {
          totalEntities: finishData?.totalEntities ?? 0,
          countsByType,
          processingTimeMs: finishData?.totalProcessingTimeMs ?? 0,
        },
      }, null, 2);
    } else {
      // ndjson: entity lines + summary
      const lines = allEntities.map((e) => JSON.stringify(e));
      lines.push(
        JSON.stringify({
          _type: "summary",
          anonymizedText: textChunks.join(""),
          totalEntities: finishData?.totalEntities ?? 0,
          processingTimeMs: finishData?.totalProcessingTimeMs ?? 0,
        }),
      );
      output = lines.join("\n");
    }

    if (!output.endsWith("\n")) {
      output += "\n";
    }
    await writeOutput(output, options.output);
  }

  // Close file output stream if writing to file (pipeline already handles this for text format)
  if (format !== "text" && options.output !== undefined && outputStream !== process.stdout) {
    await new Promise<void>((resolve) => outputStream.end(resolve));
  }

  // Save PII map
  if (anonMode === "pseudonymize" && finishData?.piiMap !== undefined) {
    const piiMapFile: PIIMapFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      ...(keyBase64 !== undefined ? { key: keyBase64 } : {}),
      piiMap: finishData.piiMap,
      stats: {
        totalEntities: finishData.totalEntities,
        countsByType,
      },
    };
    await savePIIMapFile(options["pii-map"], piiMapFile);

    if (!options.quiet) {
      process.stderr.write(
        `PII map saved to ${options["pii-map"]}\n`,
      );
    }
  }

  // Print stats to stderr if verbose
  if (options.verbose && finishData !== undefined) {
    process.stderr.write(
      formatStats({
        totalEntities: finishData.totalEntities,
        countsByType: countsByType as Record<PIIType, number>,
        processingTimeMs: finishData.totalProcessingTimeMs,
      }) + "\n",
    );
  }

  return (finishData?.totalEntities ?? 0) > 0 ? 0 : 2;
}
