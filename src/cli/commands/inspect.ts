import {
  createAnonymizer,
  type AnonymizerConfig,
  type NERConfig,
  type SecretsConfig,
  PIIType,
  mergePolicy,
  InMemoryKeyProvider,
} from "../../index.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { readInput, writeOutput } from "../utils/io.js";
import { formatInspect, formatStats } from "../utils/format.js";

function parseTypes(typesStr: string): Set<PIIType> {
  const allValues = new Set(Object.values(PIIType) as string[]);
  const types = new Set<PIIType>();
  for (const raw of typesStr.split(",")) {
    const t = raw.trim().toUpperCase();
    if (t === "") continue;
    if (!allValues.has(t)) {
      throw new CLIError(`Unknown PII type: ${raw.trim()}`);
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
    throw new CLIError(`Invalid NER mode: ${mode}`);
  }
  return mode as NERConfig["mode"];
}

export async function inspectCommand(
  filePath: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  const nerMode = validateNerMode(options.ner);
  const input = await readInput(filePath);

  const config: AnonymizerConfig = {
    mode: "pseudonymize",
    keyProvider: new InMemoryKeyProvider(),
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

  if (options.secrets) {
    const secretsConfig: SecretsConfig = {
      enabled: true,
      envFiles: options["env-file"] !== undefined ? [options["env-file"]] : undefined,
    };
    config.secrets = secretsConfig;
  }

  const policy = options.types !== undefined
    ? mergePolicy({ enabledTypes: parseTypes(options.types) })
    : undefined;

  const anonymizer = createAnonymizer(config);
  await anonymizer.initialize();

  try {
    const result = await anonymizer.anonymize(input, options.locale, policy !== undefined ? policy : undefined);

    // Build inspect entities using offsets from original text
    const inspectEntities = result.entities.map((e) => ({
      type: e.type,
      original: input.slice(e.start, e.end),
      start: e.start,
      end: e.end,
    }));

    const inspectOutput = formatInspect(input, inspectEntities);
    await writeOutput(inspectOutput + "\n", options.output);

    // Always print stats to stderr
    if (!options.quiet) {
      process.stderr.write(formatStats(result.stats) + "\n");
    }

    return result.stats.totalEntities > 0 ? 0 : 2;
  } finally {
    await anonymizer.dispose();
  }
}
