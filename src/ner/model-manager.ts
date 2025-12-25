/**
 * NER Model Manager
 * Handles automatic downloading and caching of NER models from Hugging Face Hub
 * Browser-compatible using storage abstraction layer
 */

import { getStorageProvider, type StorageProvider } from "../utils/storage.js";
import { join, basename } from "../utils/path.js";

/**
 * Available NER model variants
 */
export type NERModelMode = "standard" | "quantized" | "disabled" | "custom";

/**
 * Model file info
 */
export interface ModelFileInfo {
  /** Filename in the repo */
  repoFile: string;
  /** Local filename */
  localFile: string;
  /** Whether file is required */
  required: boolean;
}

/**
 * Model registry entry
 */
export interface ModelInfo {
  /** Model identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Approximate size */
  size: string;
  /** Hugging Face repo ID */
  hfRepo: string;
  /** Subfolder in repo (for models with multiple variants) */
  hfSubfolder?: string;
  /** Files to download */
  files: ModelFileInfo[];
  /** Label map for this model */
  labelMap: string[];
}

/**
 * Registry of available models hosted on Hugging Face Hub
 *
 * Using ELAN's ONNX exports which are optimized for JS/ONNX runtime
 * https://huggingface.co/tjruesch/xlm-roberta-base-ner-hrl-onnx
 */
export const MODEL_REGISTRY: Record<"standard" | "quantized", ModelInfo> = {
  standard: {
    id: "xlm-roberta-ner-standard",
    name: "XLM-RoBERTa NER (Standard)",
    description: "Multilingual NER model supporting EN, DE, FR, ES, and more",
    size: "~1.1 GB",
    hfRepo: "tjruesch/xlm-roberta-base-ner-hrl-onnx",
    hfSubfolder: "onnx",
    files: [
      { repoFile: "model.onnx", localFile: "model.onnx", required: true },
    ],
    labelMap: [
      "O",
      "B-DATE",
      "I-DATE",
      "B-PER",
      "I-PER",
      "B-ORG",
      "I-ORG",
      "B-LOC",
      "I-LOC",
    ],
  },
  quantized: {
    id: "xlm-roberta-ner-quantized",
    name: "XLM-RoBERTa NER (Quantized)",
    description: "Quantized version, ~4x smaller with minimal accuracy loss",
    size: "~265 MB",
    hfRepo: "tjruesch/xlm-roberta-base-ner-hrl-onnx",
    hfSubfolder: "onnx",
    files: [
      {
        repoFile: "model_quantized.onnx",
        localFile: "model.onnx",
        required: true,
      },
    ],
    labelMap: [
      "O",
      "B-DATE",
      "I-DATE",
      "B-PER",
      "I-PER",
      "B-ORG",
      "I-ORG",
      "B-LOC",
      "I-LOC",
    ],
  },
};

/**
 * Shared tokenizer files (same for both variants)
 */
const TOKENIZER_FILES: ModelFileInfo[] = [
  { repoFile: "tokenizer.json", localFile: "tokenizer.json", required: true },
  {
    repoFile: "tokenizer_config.json",
    localFile: "tokenizer_config.json",
    required: false,
  },
  {
    repoFile: "special_tokens_map.json",
    localFile: "special_tokens_map.json",
    required: false,
  },
  { repoFile: "config.json", localFile: "config.json", required: false },
];

// Cached storage provider
let storageProvider: StorageProvider | null = null;

/**
 * Gets the storage provider (lazily initialized)
 */
async function getStorage(): Promise<StorageProvider> {
  if (storageProvider === null) {
    storageProvider = await getStorageProvider();
  }
  return storageProvider;
}

/**
 * Gets the cache directory for models
 * Uses platform-specific cache location (or virtual path in browser)
 */
export async function getModelCacheDir(): Promise<string> {
  const storage = await getStorage();
  return storage.getCacheDir("models");
}

/**
 * Gets the path to a specific model variant
 */
export async function getModelPath(
  mode: "standard" | "quantized"
): Promise<string> {
  const cacheDir = await getModelCacheDir();
  return join(cacheDir, mode);
}

/**
 * Checks if a model is already downloaded
 */
export async function isModelDownloaded(
  mode: "standard" | "quantized"
): Promise<boolean> {
  const storage = await getStorage();
  const modelDir = await getModelPath(mode);
  const info = MODEL_REGISTRY[mode];

  try {
    // Check if model file exists
    const modelFile = info.files.find(
      (f) => f.required && f.localFile.includes("model")
    );
    if (modelFile) {
      const modelExists = await storage.exists(
        join(modelDir, modelFile.localFile)
      );
      if (!modelExists) return false;
    }

    // Check if tokenizer exists
    const tokenizerExists = await storage.exists(
      join(modelDir, "tokenizer.json")
    );
    return tokenizerExists;
  } catch {
    return false;
  }
}

/**
 * Progress callback for downloads
 */
export type DownloadProgressCallback = (progress: {
  file: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number | null;
}) => void;

/**
 * Builds a Hugging Face Hub download URL
 */
function getHuggingFaceUrl(
  repo: string,
  filename: string,
  subfolder?: string
): string {
  const filePath =
    subfolder !== undefined && subfolder !== ""
      ? `${subfolder}/${filename}`
      : filename;
  return `https://huggingface.co/${repo}/resolve/main/${filePath}`;
}

/**
 * Downloads a file from URL and returns the data
 */
async function downloadFileData(
  url: string,
  fileName: string,
  onProgress?: DownloadProgressCallback
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "bridge-anonymization/1.0.0",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found: ${url}`);
    }
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`
    );
  }

  const totalBytes = response.headers.get("content-length");
  const total =
    totalBytes !== null && totalBytes !== "" ? parseInt(totalBytes, 10) : null;

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("Response body is not readable");
  }

  const chunks: Uint8Array[] = [];
  let bytesDownloaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await reader.read();

    if (result.done) break;

    const value = result.value as Uint8Array;
    chunks.push(value);
    bytesDownloaded += value.length;

    if (onProgress) {
      onProgress({
        file: fileName,
        bytesDownloaded,
        totalBytes: total,
        percent:
          total !== null && total > 0
            ? Math.round((bytesDownloaded / total) * 100)
            : null,
      });
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Downloads a file from URL to storage
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: DownloadProgressCallback
): Promise<void> {
  const storage = await getStorage();
  const fileName = basename(destPath);

  const data = await downloadFileData(url, fileName, onProgress);
  await storage.writeFile(destPath, data);
}

/**
 * Downloads a model variant from Hugging Face Hub
 */
export async function downloadModel(
  mode: "standard" | "quantized",
  onProgress?: DownloadProgressCallback,
  onStatus?: (status: string) => void
): Promise<string> {
  const storage = await getStorage();
  const info = MODEL_REGISTRY[mode];
  const modelDir = await getModelPath(mode);

  // Create directory
  await storage.mkdir(modelDir);

  onStatus?.(`Downloading ${info.name} from Hugging Face Hub...`);
  onStatus?.(`Repository: ${info.hfRepo}`);

  // Download model files
  for (const file of info.files) {
    const url = getHuggingFaceUrl(info.hfRepo, file.repoFile, info.hfSubfolder);
    const destPath = join(modelDir, file.localFile);

    onStatus?.(`Downloading ${file.repoFile}...`);

    try {
      await downloadFile(url, destPath, onProgress);
    } catch (e) {
      if (file.required) {
        throw new Error(
          `Failed to download required file ${file.repoFile}: ${String(e)}`
        );
      }
      // Optional files can fail silently
      onStatus?.(`Skipping optional file ${file.repoFile}`);
    }
  }

  // Download tokenizer files (from repo root, not subfolder)
  for (const file of TOKENIZER_FILES) {
    const url = getHuggingFaceUrl(info.hfRepo, file.repoFile);
    const destPath = join(modelDir, file.localFile);

    try {
      await downloadFile(url, destPath, onProgress);
    } catch (e) {
      if (file.required) {
        throw new Error(
          `Failed to download required file ${file.repoFile}: ${String(e)}`
        );
      }
    }
  }

  // Write label map
  const labelMapPath = join(modelDir, "label_map.json");
  await storage.writeFile(labelMapPath, JSON.stringify(info.labelMap, null, 2));

  onStatus?.("Download complete!");

  return modelDir;
}

/**
 * Gets model paths if available, or downloads if needed
 */
export async function ensureModel(
  mode: "standard" | "quantized",
  options: {
    autoDownload?: boolean;
    onProgress?: DownloadProgressCallback;
    onStatus?: (status: string) => void;
  } = {}
): Promise<{ modelPath: string; vocabPath: string; labelMapPath: string }> {
  const { autoDownload = true, onProgress, onStatus } = options;

  const modelDir = await getModelPath(mode);
  const info = MODEL_REGISTRY[mode];

  // Check if already downloaded
  const isDownloaded = await isModelDownloaded(mode);

  if (!isDownloaded) {
    if (!autoDownload) {
      throw new Error(
        `NER model '${mode}' not found at ${modelDir}.\n\n` +
          `To download automatically, use:\n` +
          `  createAnonymizer({ ner: { mode: '${mode}', autoDownload: true } })\n\n` +
          `Or use regex-only mode:\n` +
          `  createAnonymizer({ ner: { mode: 'disabled' } })`
      );
    }

    await downloadModel(mode, onProgress, onStatus);
  } else {
    onStatus?.(`Using cached model: ${info.name}`);
  }

  // Find model file
  const modelFile = info.files.find((f) => f.localFile === "model.onnx");

  return {
    modelPath: join(modelDir, modelFile?.localFile ?? "model.onnx"),
    vocabPath: join(modelDir, "tokenizer.json"),
    labelMapPath: join(modelDir, "label_map.json"),
  };
}

/**
 * Clears cached models
 */
export async function clearModelCache(
  mode?: "standard" | "quantized"
): Promise<void> {
  const storage = await getStorage();

  if (mode) {
    const modelDir = await getModelPath(mode);
    await storage.rm(modelDir, { recursive: true, force: true });
  } else {
    const cacheDir = await getModelCacheDir();
    await storage.rm(cacheDir, { recursive: true, force: true });
  }
}

/**
 * Lists downloaded models
 */
export async function listDownloadedModels(): Promise<
  Array<{ mode: "standard" | "quantized"; path: string; size: string }>
> {
  const models: Array<{
    mode: "standard" | "quantized";
    path: string;
    size: string;
  }> = [];

  for (const mode of ["standard", "quantized"] as const) {
    if (await isModelDownloaded(mode)) {
      const modelPath = await getModelPath(mode);
      const info = MODEL_REGISTRY[mode];
      models.push({ mode, path: modelPath, size: info.size });
    }
  }

  return models;
}

/**
 * Gets info about available models
 */
export function getModelInfo(mode: "standard" | "quantized"): ModelInfo {
  return MODEL_REGISTRY[mode];
}

/**
 * Reads a model file as ArrayBuffer (for onnxruntime)
 */
export async function readModelFile(path: string): Promise<ArrayBuffer> {
  const storage = await getStorage();
  const data = await storage.readFile(path);
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
}

/**
 * Reads a text file from storage
 */
export async function readTextFile(path: string): Promise<string> {
  const storage = await getStorage();
  return storage.readTextFile(path);
}
