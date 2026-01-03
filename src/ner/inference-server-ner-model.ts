/**
 * Inference Server NER Model
 * NER model using remote GPU inference with server-side tokenization
 */

import { SpanMatch, AnonymizationPolicy, DetectionSource, PIIType } from "../types/index.js";
import {
  InferenceServerClient,
  type ServerEntityMatch,
} from "./inference-server-client.js";
import type { INERModel, NERPrediction } from "./ner-model.js";

/**
 * Configuration
 */
export interface InferenceServerNERModelConfig {
  /** Server URL (e.g., 'http://localhost:8080') */
  serverUrl: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Model version string */
  modelVersion?: string;
  /** Status callback */
  onStatus?: (message: string) => void;
}

// Server type → SDK PIIType mapping
const SERVER_TYPE_TO_PII_TYPE: Record<string, PIIType> = {
  'PERSON': PIIType.PERSON,
  'PER': PIIType.PERSON,
  'ORG': PIIType.ORG,
  'ORGANIZATION': PIIType.ORG,
  'LOCATION': PIIType.LOCATION,
  'LOC': PIIType.LOCATION,
  'GPE': PIIType.LOCATION,
};

/**
 * NER Model that delegates to a GPU inference server.
 * 
 * Server handles: tokenization, inference, BIO decoding, span cleanup
 * Client handles: type mapping, policy filtering
 */
export class InferenceServerNERModel implements INERModel {
  private client: InferenceServerClient;
  private config: InferenceServerNERModelConfig;
  private isLoaded = false;
  readonly version: string;

  constructor(config: InferenceServerNERModelConfig) {
    this.config = config;
    this.version = config.modelVersion ?? "2.0.0";
    this.client = new InferenceServerClient({
      url: config.serverUrl,
      timeout: config.timeout,
    });
  }

  get loaded(): boolean {
    return this.isLoaded;
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    this.config.onStatus?.("Connecting to inference server...");

    try {
      const health = await this.client.health();
      
      if (!health.model_loaded) {
        this.config.onStatus?.("Waiting for server to load model...");
        await this.client.waitUntilReady();
      }
      
      this.config.onStatus?.(`Connected (${health.provider})`);
    } catch (error) {
      throw new Error(
        `Failed to connect to ${this.config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.isLoaded = true;
    this.config.onStatus?.("Ready");
  }

  async predict(text: string, policy?: AnonymizationPolicy): Promise<NERPrediction> {
    if (!this.isLoaded) {
      throw new Error("Model not loaded. Call load() first.");
    }

    const minConfidence = this.getMinConfidence(policy);
    const result = await this.client.predict(text, minConfidence);

    let spans = this.convertToSpanMatches(result.entities);

    // Apply policy filtering
    if (policy !== undefined) {
      spans = spans.filter(
        (span) =>
          policy.enabledTypes.has(span.type) &&
          policy.nerEnabledTypes.has(span.type)
      );
    }

    return {
      spans,
      processingTimeMs: result.processingTimeMs,
      modelVersion: this.version,
    };
  }

  private convertToSpanMatches(entities: ServerEntityMatch[]): SpanMatch[] {
    const spans: SpanMatch[] = [];
    
    for (const entity of entities) {
      const piiType = SERVER_TYPE_TO_PII_TYPE[entity.type.toUpperCase()];
      if (piiType === undefined) continue;
      
      spans.push({
        type: piiType,
        start: entity.start,
        end: entity.end,
        confidence: entity.confidence,
        source: DetectionSource.NER,
        text: entity.text,
      });
    }
    
    return spans;
  }

  private getMinConfidence(policy?: AnonymizationPolicy): number {
    if (policy === undefined) return 0.5;

    let minThreshold = 1.0;
    for (const type of policy.nerEnabledTypes) {
      const threshold = policy.confidenceThresholds.get(type) ?? 0.5;
      if (threshold < minThreshold) {
        minThreshold = threshold;
      }
    }

    return minThreshold;
  }

  dispose(): Promise<void> {
    this.isLoaded = false;
    return Promise.resolve();
  }
}

/**
 * Create an Inference Server NER model
 */
export function createInferenceServerNERModel(
  config: InferenceServerNERModelConfig
): InferenceServerNERModel {
  return new InferenceServerNERModel(config);
}
