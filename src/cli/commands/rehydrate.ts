import {
  decryptPIIMap,
  base64ToUint8Array,
  rehydrate,
} from "../../index.js";
import type { RawPIIMap } from "../../pipeline/tagger.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { readInput, writeOutput } from "../utils/io.js";
import { loadPIIMapFile } from "../utils/pii-map-file.js";

export async function rehydrateCommand(
  filePath: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  const input = await readInput(filePath);
  const piiMapFile = await loadPIIMapFile(options["pii-map"]);

  // Determine encryption key
  const envKey = process.env["REHYDRA_KEY"];
  const flagKey = options.key;
  const externalKey = flagKey ?? envKey;
  const keyBase64 = externalKey ?? piiMapFile.key;

  if (keyBase64 === undefined) {
    throw new CLIError(
      "No encryption key found. Provide --key, set REHYDRA_KEY, or use a PII map file that contains the key.",
    );
  }

  const keyBytes = base64ToUint8Array(keyBase64);

  let rawPiiMap: RawPIIMap;
  try {
    rawPiiMap = await decryptPIIMap(piiMapFile.piiMap, keyBytes);
  } catch {
    throw new CLIError(
      "Failed to decrypt PII map. Check that the encryption key is correct.",
    );
  }

  const output = rehydrate(input, rawPiiMap);

  // Ensure trailing newline
  const finalOutput = output.endsWith("\n") ? output : output + "\n";
  await writeOutput(finalOutput, options.output);

  return 0;
}
