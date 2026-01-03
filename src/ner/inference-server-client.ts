/**
 * Inference Server Client
 * HTTP client for remote GPU-accelerated NER inference
 */

/**
 * Configuration for the inference server client
 */
export interface InferenceServerConfig {
  /** URL of the inference server (e.g., 'http://localhost:8080') */
  url: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Response from the inference server
 */
interface InferResponse {
  logits: number[][];
  shape: number[];
}

/**
 * Health check response
 */
export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  provider: string;
}

/**
 * Client for communicating with the Rehydra NER inference server.
 * 
 * The inference server provides GPU-accelerated NER inference using
 * ONNX Runtime with TensorRT optimization.
 * 
 * @example
 * ```typescript
 * const client = new InferenceServerClient({ url: 'http://localhost:8080' });
 * 
 * // Check health
 * const health = await client.health();
 * console.log(`Provider: ${health.provider}`);
 * 
 * // Run inference
 * const logits = await client.infer(inputIds, attentionMask);
 * ```
 */
export class InferenceServerClient {
  private readonly url: string;
  private readonly timeout: number;

  constructor(config: InferenceServerConfig) {
    // Normalize URL (remove trailing slash)
    this.url = config.url.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Run NER inference on tokenized input
   * 
   * @param inputIds - Array of token IDs
   * @param attentionMask - Array of attention mask values
   * @returns Float32Array of logits (flattened [seq_length * num_labels])
   */
  async infer(inputIds: number[], attentionMask: number[]): Promise<Float32Array> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.url}/v1/infer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input_ids: inputIds,
          attention_mask: attentionMask,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Inference server error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as InferResponse;
      
      // Flatten the 2D logits array to match local ONNX Runtime output format
      const flatLogits: number[] = [];
      for (const row of data.logits) {
        flatLogits.push(...row);
      }
      
      return new Float32Array(flatLogits);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Inference server request timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check the health of the inference server
   * 
   * @returns Health status including active provider
   */
  async health(): Promise<HealthStatus> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }

      return await response.json() as HealthStatus;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Health check timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Wait for the inference server to become ready
   * 
   * @param maxWaitMs - Maximum time to wait in milliseconds (default: 300000 = 5 minutes)
   * @param pollIntervalMs - Interval between health checks (default: 2000)
   * @returns Health status when ready
   */
  async waitUntilReady(maxWaitMs = 300000, pollIntervalMs = 2000): Promise<HealthStatus> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const health = await this.health();
        if (health.model_loaded) {
          return health;
        }
      } catch {
        // Server not ready yet, continue polling
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error(`Inference server did not become ready within ${maxWaitMs}ms`);
  }
}

/**
 * Create an inference server client
 * 
 * @param config - Client configuration
 * @returns Configured client instance
 */
export function createInferenceServerClient(config: InferenceServerConfig): InferenceServerClient {
  return new InferenceServerClient(config);
}

