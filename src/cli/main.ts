import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { setNoColor, red, bold, dim } from "./utils/color.js";
import { anonymizeCommand } from "./commands/anonymize.js";
import { rehydrateCommand } from "./commands/rehydrate.js";
import { inspectCommand } from "./commands/inspect.js";
import { setupNerCommand } from "./commands/setup-ner.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export interface ParsedOptions {
  output?: string;
  format: string;
  ner: string;
  "pii-map": string;
  key?: string;
  types?: string;
  mode: string;
  locale?: string;
  verbose: boolean;
  quiet: boolean;
}

const HELP_TEXT = `
${bold("rehydra")} — PII anonymization CLI

${bold("USAGE")}
  rehydra <command> [file] [options]

${bold("COMMANDS")}
  anonymize <file>     Anonymize a file or stdin
  rehydrate <file>     Rehydrate a previously anonymized file
  inspect <file>       Show detected PII without anonymizing (dry run)
  setup-ner            Download and set up NER model

${bold("OPTIONS")}
  -o, --output <file>      Output file (default: stdout)
  -f, --format <format>    Output format: text, json, ndjson (default: text)
      --ner <mode>         NER mode: disabled, quantized, standard (default: disabled)
      --pii-map <file>     PII map file path (default: .rehydra-pii-map.json)
      --key <key>          Encryption key (or set REHYDRA_KEY env var)
      --types <types>      Comma-separated PII types to detect (default: all)
      --mode <mode>        anonymize | pseudonymize (default: pseudonymize)
      --locale <locale>    Locale hint for detection (e.g., de-DE)
      --no-color           Disable colored output
      --verbose            Show detection details
  -q, --quiet              Suppress non-essential output
  -h, --help               Show this help
  -V, --version            Show version

${bold("EXAMPLES")}
  ${dim("# Anonymize a file")}
  rehydra anonymize input.txt -o output.txt

  ${dim("# Pipe from stdin")}
  cat data.csv | rehydra anonymize > anonymized.csv

  ${dim("# JSON output with NER")}
  rehydra anonymize input.txt --ner quantized -f json

  ${dim("# Rehydrate")}
  rehydra rehydrate anonymized.txt --pii-map .rehydra-pii-map.json

  ${dim("# Inspect detected PII")}
  rehydra inspect input.txt

${bold("EXIT CODES")}
  0  Success
  1  Error
  2  No PII found
`;

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        output: { type: "string", short: "o" },
        format: { type: "string", short: "f", default: "text" },
        ner: { type: "string", default: "disabled" },
        "pii-map": { type: "string", default: ".rehydra-pii-map.json" },
        key: { type: "string" },
        types: { type: "string" },
        mode: { type: "string", default: "pseudonymize" },
        locale: { type: "string" },
        "no-color": { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "V", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(red(`Error: ${msg}\n`));
    process.stderr.write(`Run ${dim("rehydra --help")} for usage.\n`);
    return 1;
  }

  if (values["no-color"] === true) {
    setNoColor(true);
  }

  if (values["help"] === true) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (values["version"] === true) {
    process.stdout.write(`rehydra ${pkg.version}\n`);
    return 0;
  }

  const command = positionals[0];
  const filePath = positionals[1];

  if (command === undefined) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const options: ParsedOptions = {
    output: values["output"] as string | undefined,
    format: (values["format"] as string | undefined) ?? "text",
    ner: (values["ner"] as string | undefined) ?? "disabled",
    "pii-map": (values["pii-map"] as string | undefined) ?? ".rehydra-pii-map.json",
    key: values["key"] as string | undefined,
    types: values["types"] as string | undefined,
    mode: (values["mode"] as string | undefined) ?? "pseudonymize",
    locale: values["locale"] as string | undefined,
    verbose: values["verbose"] === true,
    quiet: values["quiet"] === true,
  };

  switch (command) {
    case "anonymize":
      return anonymizeCommand(filePath, options);
    case "rehydrate":
      return rehydrateCommand(filePath, options);
    case "inspect":
      return inspectCommand(filePath, options);
    case "setup-ner":
      return setupNerCommand(options);
    default:
      process.stderr.write(red(`Unknown command: ${command}\n`));
      process.stderr.write(`Run ${dim("rehydra --help")} for usage.\n`);
      return 1;
  }
}
