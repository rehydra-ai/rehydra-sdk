/**
 * Rehydra Plugin Factory for OpenCode
 *
 * Creates an OpenCode plugin that pseudonymizes secrets in outbound LLM
 * requests and rehydrates them in responses by wrapping globalThis.fetch.
 */

import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import {
  createAnonymizer,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
} from "../index.js";
import { detectProvider } from "../proxy/index.js";
import { AnonymizerSessionImpl } from "../storage/session.js";
import { rehydrate } from "../pipeline/tagger.js";
import { decryptPIIMap } from "../crypto/index.js";
import type { KeyProvider } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";
import { resolveConfig } from "./config.js";
import type { RehydraPluginOptions, RehydraLogLevel } from "./types.js";

/**
 * Recursively walks a value and rehydrates all string properties
 * that contain PII tags. Handles nested objects/arrays so that
 * PII tags inside JSON-encoded strings (e.g., function call arguments)
 * are rehydrated at the correct escaping level.
 */
function deepRehydrateValue(
  value: unknown,
  piiMap: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    if (value.includes("<PII") || value.includes("&lt;PII")) {
      return rehydrate(value, piiMap);
    }
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const r = deepRehydrateValue(item, piiMap);
      if (r !== item) changed = true;
      return r;
    });
    return changed ? result : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = deepRehydrateValue(v, piiMap);
      if (r !== v) changed = true;
      result[k] = r;
    }
    return changed ? result : value;
  }
  return value;
}

function mapProvider(
  provider: string,
): "openai" | "anthropic" | "auto" {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  return "auto";
}

/**
 * Simple log helper that writes to a file based on log level.
 */
function writeLog(
  logFile: string | null,
  logLevel: RehydraLogLevel,
  minLevel: RehydraLogLevel,
  entry: Record<string, unknown>,
): void {
  if (!logFile || !logLevel) return;
  // "normal" logs at normal+debug, "debug" logs only at debug
  if (minLevel === "debug" && logLevel !== "debug") return;
  try {
    appendFileSync(logFile, JSON.stringify(entry, null, 2) + "\n---\n", "utf-8");
  } catch {
    // Ignore logging errors
  }
}

/**
 * Creates an OpenCode plugin that intercepts LLM API requests,
 * pseudonymizes secrets, and rehydrates responses.
 */
export function createRehydraPlugin(options: RehydraPluginOptions) {
  return async (input: { directory: string }): Promise<Record<string, unknown>> => {
    const config = resolveConfig(options, input.directory);
    const providerHint = mapProvider(options.provider);

    const keyProvider: KeyProvider = new InMemoryKeyProvider();
    const piiStorage: PIIStorageProvider = new InMemoryPIIStorageProvider();

    const anonymizer = createAnonymizer({
      secrets: {
        enabled: true,
        envFiles: config.envFiles?.map((f) =>
          f.startsWith("/") ? f : resolve(input.directory, f),
        ),
        redactValues: config.redactValues,
        minValueLength: config.minValueLength,
      },
      keyProvider,
      piiStorageProvider: piiStorage,
    });

    let initialized = false;
    let sessionCounter = 0;

    const logFile = config.logFile
      ? (config.logFile.startsWith("/") ? config.logFile : resolve(input.directory, config.logFile))
      : null;
    const logLevel = config.logLevel;

    // Capture original fetch before patching
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (fetchInput: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Only intercept POST + JSON
      if (init?.method !== "POST" || typeof init.body !== "string") {
        return originalFetch(fetchInput, init);
      }

      const contentType = init.headers instanceof Headers
        ? init.headers.get("content-type")
        : typeof init.headers === "object" && init.headers !== null
          ? (init.headers as Record<string, string>)["content-type"]
          : undefined;

      if (!contentType?.includes("application/json")) {
        return originalFetch(fetchInput, init);
      }

      let body: unknown;
      try {
        body = JSON.parse(init.body);
      } catch {
        return originalFetch(fetchInput, init);
      }

      if (body === null || body === undefined || typeof body !== "object") {
        return originalFetch(fetchInput, init);
      }

      const provider = detectProvider("", new Headers(), providerHint);
      const texts = provider.extractRequestText(body);

      // Debug: log full request structure
      writeLog(logFile, logLevel, "debug", {
        timestamp: new Date().toISOString(),
        provider: provider.name,
        bodyKeys: Object.keys(body as Record<string, unknown>),
        hasMessages: Array.isArray((body as Record<string, unknown>).messages),
        messageCount: Array.isArray((body as Record<string, unknown>).messages)
          ? ((body as Record<string, unknown>).messages as unknown[]).length : 0,
        textsExtracted: texts.length,
        firstMessagePreview: Array.isArray((body as Record<string, unknown>).messages) &&
          ((body as Record<string, unknown>).messages as unknown[]).length > 0
          ? JSON.stringify(((body as Record<string, unknown>).messages as unknown[])[0]).slice(0, 200)
          : null,
        texts: texts,
        rawInputPreview: Array.isArray((body as Record<string, unknown>).input)
          ? ((body as Record<string, unknown>).input as unknown[]).map((item: unknown) => {
              const obj = item as Record<string, unknown>;
              return { type: obj.type, role: obj.role, keys: Object.keys(obj) };
            })
          : typeof (body as Record<string, unknown>).input,
      });

      if (texts.length === 0) {
        return originalFetch(fetchInput, init);
      }

      // Initialize anonymizer on first request
      if (!initialized) {
        await anonymizer.initialize();
        initialized = true;
      }

      const sessionId = `rehydra-${Date.now()}-${++sessionCounter}`;
      const session = new AnonymizerSessionImpl(
        anonymizer,
        sessionId,
        piiStorage,
        keyProvider,
      );

      // Anonymize each text
      const anonymizedTexts: string[] = [];
      let totalEntities = 0;
      const typeCounts: Record<string, number> = {};
      for (const text of texts) {
        const result = await session.anonymize(text);
        anonymizedTexts.push(result.anonymizedText);
        totalEntities += result.stats.totalEntities;
        for (const [type, count] of Object.entries(result.stats.countsByType)) {
          if (count > 0) {
            typeCounts[type] = (typeCounts[type] ?? 0) + count;
          }
        }
      }

      if (totalEntities > 0) {
        // Normal: compact one-liner with PII types and counts
        writeLog(logFile, logLevel, "normal", {
          timestamp: new Date().toISOString(),
          sessionId,
          scrubbed: typeCounts,
        });

        // Debug: full diffs showing original → anonymized
        const diffs: { original: string; anonymized: string }[] = [];
        for (let i = 0; i < texts.length; i++) {
          if (texts[i] !== anonymizedTexts[i]) {
            diffs.push({ original: texts[i]!, anonymized: anonymizedTexts[i]! });
          }
        }
        writeLog(logFile, logLevel, "debug", {
          timestamp: new Date().toISOString(),
          sessionId,
          totalEntities,
          diffs,
        });
      }

      // Rebuild body with anonymized text
      const anonymizedBody = provider.rebuildRequestBody(body, anonymizedTexts) as Record<string, unknown>;

      // Inject rehydration instruction into the system prompt so the LLM
      // treats PII placeholders as real values
      if (totalEntities > 0 && typeof anonymizedBody.instructions === "string") {
        anonymizedBody.instructions =
          anonymizedBody.instructions +
          "\n\n<rehydra>\n" +
          "Some values in this conversation have been replaced with PII placeholders " +
          'like <PII type="..." id="..."/>. These are real values that have been ' +
          "masked for privacy during transit. They will be automatically rehydrated " +
          "(replaced with the original values) before any command is executed locally.\n" +
          "IMPORTANT: Treat these placeholders exactly like real values. Do NOT try to " +
          "resolve, decode, remove, or work around them. Use them as-is in commands, " +
          "code, and tool calls. The rehydration layer handles the rest.\n" +
          "</rehydra>";
      }

      // Forward with anonymized body
      const response = await originalFetch(fetchInput, {
        ...init,
        body: JSON.stringify(anonymizedBody),
      });

      // Rehydrate response
      const responseContentType = response.headers.get("content-type");

      // Determine if this is a streaming response: check content-type,
      // fall back to checking if the request body had stream: true
      const isStreamingResponse =
        responseContentType?.includes("text/event-stream") ||
        (responseContentType === null && (body as Record<string, unknown>).stream === true);

      if (responseContentType?.includes("application/json")) {
        // Non-streaming: deep-rehydrate the JSON response
        try {
          const resText = await response.text();
          if (resText.includes("<PII")) {
            const piiMap = await (async () => {
              const stored = await piiStorage.load(sessionId);
              if (stored !== null) {
                const key = await keyProvider.getKey();
                return decryptPIIMap(stored.piiMap, key);
              }
              return new Map<string, string>();
            })();
            // Deep-rehydrate: parse JSON, walk all string values, rehydrate each
            try {
              const parsed = JSON.parse(resText) as unknown;
              const rehydratedObj = deepRehydrateValue(parsed, piiMap);
              return new Response(JSON.stringify(rehydratedObj), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            } catch {
              // Fallback: string-level rehydration
              const rehydrated = rehydrate(resText, piiMap);
              return new Response(rehydrated, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
          }
          return new Response(resText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch {
          return response;
        }
      }

      if (isStreamingResponse && response.body) {
        // Streaming SSE: rehydrate each delta
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let tagBuffer = "";
        let fnCallArgBuffer = "";
        let piiMap: Map<string, string> | null = null;

        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            const text = decoder.decode(chunk, { stream: true });

            // Lazy-load PII map
            if (piiMap === null) {
              try {
                const stored = await piiStorage.load(sessionId);
                if (stored !== null) {
                  const key = await keyProvider.getKey();
                  piiMap = await decryptPIIMap(stored.piiMap, key);
                } else {
                  piiMap = new Map();
                }
              } catch {
                piiMap = new Map();
              }
            }

            // Parse SSE events from chunk
            const lines = text.split("\n");
            const output: string[] = [];

            for (const line of lines) {
              if (!line.startsWith("data: ")) {
                output.push(line);
                continue;
              }

              const data = line.slice(6);
              if (data === "[DONE]") {
                output.push(line);
                continue;
              }

              try {
                const parsed = JSON.parse(data) as unknown;
                const delta = provider.extractSSEDelta(parsed);

                if (delta === null) {
                  const eventObj = parsed as Record<string, unknown>;
                  const eventType = typeof eventObj.type === "string" ? eventObj.type : "";

                  // Function call argument deltas: buffer + rehydrate with
                  // tag-splitting awareness (same logic as text deltas)
                  if (eventType === "response.function_call_arguments.delta" && typeof eventObj.delta === "string") {
                    const fullText = fnCallArgBuffer + eventObj.delta;
                    const incompleteTagIdx = fullText.lastIndexOf("<PII");
                    const lastCloseIdx = fullText.lastIndexOf("/>");

                    let textToEmit: string;
                    if (incompleteTagIdx !== -1 && (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)) {
                      textToEmit = fullText.slice(0, incompleteTagIdx);
                      fnCallArgBuffer = fullText.slice(incompleteTagIdx);
                    } else {
                      textToEmit = fullText;
                      fnCallArgBuffer = "";
                    }

                    if (textToEmit.length > 0) {
                      const rehydrated = rehydrate(textToEmit, piiMap!);
                      output.push(`data: ${JSON.stringify({ ...eventObj, delta: rehydrated })}`);
                    } else {
                      output.push(`data: ${JSON.stringify({ ...eventObj, delta: "" })}`);
                    }
                    continue;
                  }

                  // Function call arguments done: flush buffer + rehydrate complete args
                  if (eventType === "response.function_call_arguments.done") {
                    const rebuilt = { ...eventObj };
                    if (fnCallArgBuffer.length > 0) {
                      const flushed = rehydrate(fnCallArgBuffer, piiMap!);
                      fnCallArgBuffer = "";
                      // Emit buffered content as a preceding delta
                      output.push(`data: ${JSON.stringify({ type: "response.function_call_arguments.delta", item_id: eventObj.item_id, output_index: eventObj.output_index, delta: flushed })}`);
                    }
                    if (typeof rebuilt.arguments === "string") {
                      rebuilt.arguments = rehydrate(rebuilt.arguments, piiMap!);
                    }
                    output.push(`data: ${JSON.stringify(rebuilt)}`);
                    continue;
                  }

                  // Other non-text events: deep-rehydrate all string values
                  const dataStr = JSON.stringify(parsed);
                  if (dataStr.includes("<PII") || dataStr.includes("&lt;PII")) {
                    const rehydratedObj = deepRehydrateValue(parsed, piiMap!);
                    output.push(`data: ${JSON.stringify(rehydratedObj)}`);
                  } else {
                    output.push(line);
                  }
                  continue;
                }

                const fullText = tagBuffer + delta;
                const incompleteTagIdx = fullText.lastIndexOf("<PII");
                const lastCloseIdx = fullText.lastIndexOf("/>");

                let textToRehydrate: string;
                if (incompleteTagIdx !== -1 && (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)) {
                  textToRehydrate = fullText.slice(0, incompleteTagIdx);
                  tagBuffer = fullText.slice(incompleteTagIdx);
                } else {
                  textToRehydrate = fullText;
                  tagBuffer = "";
                }

                if (textToRehydrate.length > 0) {
                  const rehydrated = rehydrate(textToRehydrate, piiMap!);
                  const rebuilt = provider.rebuildSSEDelta(parsed, rehydrated);
                  output.push(`data: ${JSON.stringify(rebuilt)}`);
                } else {
                  // Buffering incomplete tag — emit empty delta
                  const rebuilt = provider.rebuildSSEDelta(parsed, "");
                  output.push(`data: ${JSON.stringify(rebuilt)}`);
                }
              } catch {
                output.push(line);
              }
            }

            controller.enqueue(encoder.encode(output.join("\n")));
          },

          async flush(controller) {
            if (tagBuffer.length > 0 && piiMap !== null) {
              const rehydrated = rehydrate(tagBuffer, piiMap);
              if (rehydrated.length > 0) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content: rehydrated })}\n\n`),
                );
              }
              tagBuffer = "";
            }
            if (fnCallArgBuffer.length > 0 && piiMap !== null) {
              const rehydrated = rehydrate(fnCallArgBuffer, piiMap);
              if (rehydrated.length > 0) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "response.function_call_arguments.delta", delta: rehydrated })}\n\n`),
                );
              }
              fnCallArgBuffer = "";
            }
          },
        });

        return new Response(response.body.pipeThrough(transformStream), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Not JSON or SSE — return as-is
      return response;
    };

    return {};
  };
}
