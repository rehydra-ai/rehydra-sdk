import {
  isModelDownloaded,
  downloadModel,
  type DownloadProgressCallback,
} from "../../index.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { green, bold } from "../utils/color.js";
import { formatProgress, writeProgress, clearProgress } from "../utils/progress.js";

export async function setupNerCommand(
  options: ParsedOptions,
): Promise<number> {
  const mode = options.ner === "standard" ? "standard" : "quantized";

  const alreadyDownloaded = await isModelDownloaded(mode);
  if (alreadyDownloaded) {
    if (!options.quiet) {
      process.stderr.write(
        green(`NER model (${mode}) is already downloaded.\n`),
      );
    }
    return 0;
  }

  if (!options.quiet) {
    process.stderr.write(
      bold(`Downloading NER model (${mode})...\n`),
    );
  }

  const onProgress: DownloadProgressCallback = (progress) => {
    if (!options.quiet) {
      writeProgress(formatProgress(progress.file, progress.percent));
    }
  };

  const onStatus = options.quiet
    ? undefined
    : (status: string): void => {
        clearProgress();
        process.stderr.write(`${status}\n`);
      };

  try {
    await downloadModel(mode, onProgress, onStatus);
  } catch (err) {
    clearProgress();
    throw new CLIError(
      `Failed to download NER model: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  clearProgress();
  if (!options.quiet) {
    process.stderr.write(green(`\nNER model (${mode}) downloaded successfully.\n`));
  }

  return 0;
}
