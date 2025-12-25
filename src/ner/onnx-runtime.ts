/**
 * ONNX Runtime Abstraction
 * Allows switching between onnxruntime-node and onnxruntime-web
 * 
 * In browsers without a bundler, automatically loads onnxruntime-web from CDN
 */

// CDN URL for onnxruntime-web (used when bare import fails in browser)
// Using the bundled ESM version that includes WebAssembly backend
const ONNX_WEB_CDN_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.bundle.min.mjs";

// Type definitions that match both runtimes
export interface OrtTensor {
  data: Float32Array | BigInt64Array | Int32Array;
  dims: readonly number[];
}

export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export interface OrtInferenceSession {
  create(
    pathOrBuffer: string | ArrayBuffer | Uint8Array,
    options?: unknown
  ): Promise<OrtSession>;
}

export interface OrtTensorConstructor {
  new (
    type: string,
    data: Float32Array | BigInt64Array | Int32Array | number[] | bigint[],
    dims: number[]
  ): OrtTensor;
}

export interface OrtRuntime {
  InferenceSession: OrtInferenceSession;
  Tensor: OrtTensorConstructor;
}

/**
 * Runtime detection and loading
 */
let _runtime: OrtRuntime | null = null;
let _runtimeType: "node" | "web" | null = null;

/**
 * Detects the best ONNX runtime for the current environment
 */
export function detectRuntime(): "node" | "web" {
  // Check if we're in Bun
  const isBun = typeof globalThis.Bun !== "undefined";

  // Check if we're in a browser-like environment
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isBrowser = typeof globalThis.window !== "undefined";

  // Check if we're in Deno
  const isDeno = typeof globalThis.Deno !== "undefined";

  if (isBrowser || isDeno) {
    return "web";
  }

  // For Bun, try node first, fall back to web
  if (isBun) {
    try {
      // Quick check if onnxruntime-node is loadable
      require.resolve("onnxruntime-node");
      return "node";
    } catch {
      return "web";
    }
  }

  // Default to node for Node.js
  return "node";
}

/**
 * Attempts to load onnxruntime-web, first via bare import, then via CDN
 */
async function loadOnnxWeb(): Promise<OrtRuntime> {
  // First try bare import (works with bundlers or import maps)
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - onnxruntime-web may not be installed
    const ort = (await import("onnxruntime-web")) as OrtRuntime;
    return ort;
  } catch {
    // Bare import failed, try CDN (for browsers without bundlers)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const isBrowser = typeof globalThis.window !== "undefined";
    if (isBrowser) {
      try {
        // Dynamic import from CDN URL
        const ort = (await import(
          /* webpackIgnore: true */ ONNX_WEB_CDN_URL
        )) as OrtRuntime;
        return ort;
      } catch (cdnError) {
        throw new Error(
          `Failed to load onnxruntime-web from CDN: ${String(cdnError)}`
        );
      }
    }
    throw new Error("onnxruntime-web is not available");
  }
}

/**
 * Loads the appropriate ONNX runtime
 */
export async function loadRuntime(
  preferredRuntime?: "node" | "web"
): Promise<OrtRuntime> {
  if (_runtime !== null) {
    return _runtime;
  }

  const runtimeType = preferredRuntime ?? detectRuntime();

  try {
    if (runtimeType === "node") {
      // Dynamic import for onnxruntime-node
      const ort = (await import("onnxruntime-node")) as OrtRuntime;
      _runtime = ort;
      _runtimeType = "node";
    } else {
      // Load onnxruntime-web (with CDN fallback for browsers)
      const ort = await loadOnnxWeb();
      _runtime = ort;
      _runtimeType = "web";
    }
  } catch (e) {
    // If preferred runtime fails, try the other
    const fallbackType = runtimeType === "node" ? "web" : "node";

    try {
      if (fallbackType === "node") {
        const ort = (await import("onnxruntime-node")) as OrtRuntime;
        _runtime = ort;
        _runtimeType = "node";
      } else {
        // Load onnxruntime-web (with CDN fallback for browsers)
        const ort = await loadOnnxWeb();
        _runtime = ort;
        _runtimeType = "web";
      }
    } catch {
      throw new Error(
        `Failed to load ONNX runtime. Install either 'onnxruntime-node' or 'onnxruntime-web'.\n` +
          `Original error: ${String(e)}`
      );
    }
  }

  return _runtime;
}

/**
 * Gets the currently loaded runtime type
 */
export function getRuntimeType(): "node" | "web" | null {
  return _runtimeType;
}

/**
 * Resets the runtime (useful for testing)
 */
export function resetRuntime(): void {
  _runtime = null;
  _runtimeType = null;
}

// Add runtime type declarations
declare global {
  // eslint-disable-next-line no-var
  var Bun: unknown;
  // eslint-disable-next-line no-var
  var Deno: unknown;
}
