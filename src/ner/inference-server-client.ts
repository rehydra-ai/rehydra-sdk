/**
 * Inference Server Client
 * HTTP client for GPU-accelerated NER inference
 */

/**
 * Client configuration
 */
export interface InferenceServerConfig {
  /** Server URL (e.g., 'http://localhost:8080') */
  url: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Entity match from the server
 */
export interface ServerEntityMatch {
  /** Entity type (PERSON, ORG, LOCATION, etc.) */
  type: string;
  /** Start character offset */
  start: number;
  /** End character offset */
  end: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Matched text */
  text: string;
}

/**
 * Server response
 */
interface PredictResponse {
  entities: ServerEntityMatch[];
  processing_time_ms: number;
}

/**
 * Health status
 */
export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  provider: string;
}

/**
 * Client for the Rehydra NER inference server.
 * 
 * @example
 * ```typescript
 * const client = new InferenceServerClient({ url: 'http://localhost:8080' });
 * 
 * await client.waitUntilReady();
 * 
 * const result = await client.predict('John Smith works at Acme Corp');
 * console.log(result.entities);
 * // [{ type: 'PERSON', text: 'John Smith', ... }, { type: 'ORG', text: 'Acme Corp', ... }]
 * ```
 */
export class InferenceServerClient {
  private readonly url: string;
  private readonly timeout: number;

  constructor(config: InferenceServerConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Run NER prediction on text
   * 
   * @param text - Text to analyze
   * @param confidenceThreshold - Minimum confidence (0-1, default: 0.5)
   */
  async predict(
    text: string,
    confidenceThreshold: number = 0.5
  ): Promise<{ entities: ServerEntityMatch[]; processingTimeMs: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.url}/v1/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          confidence_threshold: confidenceThreshold,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as PredictResponse;
      return {
        entities: data.entities,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check server health
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
   * Wait for server to be ready
   * 
   * @param maxWaitMs - Max wait time (default: 300000 = 5 min)
   * @param pollIntervalMs - Poll interval (default: 2000)
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
        // Not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error(`Server not ready within ${maxWaitMs}ms`);
  }
}

/**
 * Create client instance
 */
export function createInferenceServerClient(config: InferenceServerConfig): InferenceServerClient {
  return new InferenceServerClient(config);
}
