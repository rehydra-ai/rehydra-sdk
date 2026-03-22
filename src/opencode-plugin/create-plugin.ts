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
import { rehydrate, deepRehydrateValue } from "../pipeline/tagger.js";
import { decryptPIIMap } from "../crypto/index.js";
import type { KeyProvider } from "../crypto/index.js";
import type { PIIStorageProvider } from "../storage/types.js";
import { resolveConfig } from "./config.js";
import type { RehydraPluginOptions, RehydraLogLevel } from "./types.js";

/**
 * Tracks rehydration stats for response-side logging.
 * Uses simple before/after diffing instead of independent tag extraction,
 * so it catches every rehydration that `rehydrate()` actually performs.
 */
interface RehydrationTracker {
  count: number;
  channels: Set<string>;
  fragments: Array<{ channel: string; before: string; after: string }>;
}

function createTracker(): RehydrationTracker {
  return { count: 0, channels: new Set(), fragments: [] };
}

/**
 * Call rehydrate() and track the result. If the text changed,
 * record it as a rehydration event.
 */
function rehydrateAndTrack(
  tracker: RehydrationTracker,
  text: string,
  piiMap: Map<string, string>,
  channel: "text" | "tool_call" | "json",
): string {
  const result = rehydrate(text, piiMap);
  if (result !== text) {
    tracker.count++;
    tracker.channels.add(channel);
    tracker.fragments.push({ channel, before: text, after: result });
  }
  return result;
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
  if (logFile === null || logLevel === false) return;
  // "info" logs at normal+debug, "debug" logs only at debug
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
  return (input: { directory: string }): Record<string, unknown> => {
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

    const logFile = config.logFile !== null
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

      if (contentType === undefined || contentType === null || !contentType.includes("application/json")) {
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

      // Auto-detect provider from request URL, falling back to configured hint
      const url = typeof fetchInput === "string"
        ? fetchInput
        : fetchInput instanceof URL ? fetchInput.toString() : fetchInput.url;
      const reqHeaders = init.headers instanceof Headers
        ? init.headers
        : new Headers((init.headers as Record<string, string>) ?? {});
      const provider = detectProvider(url, reqHeaders, providerHint, body);
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
        writeLog(logFile, logLevel, "info", {
          timestamp: new Date().toISOString(),
          direction: "request",
          provider: provider.name,
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
          direction: "request",
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
        (responseContentType !== null && responseContentType !== undefined && responseContentType.includes("text/event-stream")) ||
        (responseContentType === null && (body as Record<string, unknown>).stream === true);

      if (responseContentType !== null && responseContentType !== undefined && responseContentType.includes("application/json")) {
        // Non-streaming: deep-rehydrate the JSON response
        try {
          const resText = await response.text();
          if (resText.includes("<PII")) {
            const piiMap = await (async (): Promise<Map<string, string>> => {
              const stored = await piiStorage.load(sessionId);
              if (stored !== null) {
                const key = await keyProvider.getKey();
                return decryptPIIMap(stored.piiMap, key);
              }
              return new Map<string, string>();
            })();

            const tracker = createTracker();

            // Deep-rehydrate: parse JSON, walk all string values, rehydrate each
            let rehydratedResponse: Response;
            try {
              const parsed = JSON.parse(resText) as unknown;
              const rehydratedObj = deepRehydrateValue(parsed, piiMap);
              const rehydratedStr = JSON.stringify(rehydratedObj);
              if (rehydratedStr !== resText) {
                tracker.count++;
                tracker.channels.add("json");
                tracker.fragments.push({ channel: "json", before: resText, after: rehydratedStr });
              }
              rehydratedResponse = new Response(rehydratedStr, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            } catch {
              // Fallback: string-level rehydration
              const rehydrated = rehydrateAndTrack(tracker, resText, piiMap, "json");
              rehydratedResponse = new Response(rehydrated, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }

            // Log rehydration results
            if (tracker.count > 0) {
              writeLog(logFile, logLevel, "info", {
                timestamp: new Date().toISOString(),
                direction: "response",
                provider: provider.name,
                sessionId,
                rehydrated: tracker.count,
                channels: [...tracker.channels],
              });
              writeLog(logFile, logLevel, "debug", {
                timestamp: new Date().toISOString(),
                direction: "response",
                sessionId,
                rehydratedFragments: tracker.fragments,
              });
            }

            return rehydratedResponse;
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
        let lastTextEvent: unknown = null;
        let lastToolCallEvent: unknown = null;
        let lineBuffer = "";
        const tracker = createTracker();

        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller): Promise<void> {
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

            // Buffer incomplete lines across chunks: SSE data lines can be
            // split across TCP segments, so we only process lines terminated
            // by \n and carry the trailing fragment to the next chunk.
            const combined = lineBuffer + text;
            const parts = combined.split("\n");
            lineBuffer = parts.pop() ?? "";
            const lines = parts;
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
                  // Tool call argument deltas: buffer + rehydrate with
                  // tag-splitting awareness (same logic as text deltas)
                  const toolDelta = provider.extractSSEToolCallDelta(parsed);
                  if (toolDelta !== null) {
                    lastToolCallEvent = parsed;
                    const fullText = fnCallArgBuffer + toolDelta;
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
                      const rehydrated = rehydrateAndTrack(tracker, textToEmit, piiMap, "tool_call");
                      output.push(`data: ${JSON.stringify(provider.rebuildSSEToolCallDelta(parsed, rehydrated))}`);
                    } else {
                      output.push(`data: ${JSON.stringify(provider.rebuildSSEToolCallDelta(parsed, ""))}`);
                    }
                    continue;
                  }

                  // Tool call done: flush buffer + deep-rehydrate the done event
                  if (provider.isSSEToolCallDone(parsed)) {
                    if (fnCallArgBuffer.length > 0) {
                      const flushed = rehydrateAndTrack(tracker, fnCallArgBuffer, piiMap, "tool_call");
                      fnCallArgBuffer = "";
                      // Emit buffered content as a preceding tool call delta
                      output.push(`data: ${JSON.stringify(provider.rebuildSSEToolCallDelta(parsed, flushed))}`);
                    }
                    // Deep-rehydrate the done event (handles complete arguments fields)
                    const doneStr = JSON.stringify(parsed);
                    const rehydratedDone = deepRehydrateValue(parsed, piiMap);
                    const rehydratedDoneStr = JSON.stringify(rehydratedDone);
                    if (rehydratedDoneStr !== doneStr) {
                      tracker.count++;
                      tracker.channels.add("tool_call");
                      tracker.fragments.push({ channel: "tool_call", before: doneStr, after: rehydratedDoneStr });
                    }
                    output.push(`data: ${rehydratedDoneStr}`);
                    continue;
                  }

                  // Other non-text events: deep-rehydrate all string values
                  const dataStr = JSON.stringify(parsed);
                  if (dataStr.includes("<PII") || dataStr.includes("&lt;PII")) {
                    const rehydratedObj = deepRehydrateValue(parsed, piiMap);
                    const rehydratedStr = JSON.stringify(rehydratedObj);
                    if (rehydratedStr !== dataStr) {
                      tracker.count++;
                      tracker.channels.add("text");
                      tracker.fragments.push({ channel: "text", before: dataStr, after: rehydratedStr });
                    }
                    output.push(`data: ${rehydratedStr}`);
                  } else {
                    output.push(line);
                  }
                  continue;
                }

                lastTextEvent = parsed;
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
                  const rehydrated = rehydrateAndTrack(tracker, textToRehydrate, piiMap, "text");
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

            if (output.length > 0) {
              controller.enqueue(encoder.encode(output.join("\n") + "\n"));
            }
          },

          flush(controller): void {
            // Flush any trailing incomplete line from the buffer
            if (lineBuffer.length > 0) {
              controller.enqueue(encoder.encode(lineBuffer));
              lineBuffer = "";
            }
            if (tagBuffer.length > 0 && piiMap !== null && lastTextEvent !== null) {
              const rehydrated = rehydrateAndTrack(tracker, tagBuffer, piiMap, "text");
              if (rehydrated.length > 0) {
                const rebuilt = provider.rebuildSSEDelta(lastTextEvent, rehydrated);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(rebuilt)}\n\n`),
                );
              }
              tagBuffer = "";
            }
            if (fnCallArgBuffer.length > 0 && piiMap !== null && lastToolCallEvent !== null) {
              const rehydrated = rehydrateAndTrack(tracker, fnCallArgBuffer, piiMap, "tool_call");
              if (rehydrated.length > 0) {
                const rebuilt = provider.rebuildSSEToolCallDelta(lastToolCallEvent, rehydrated);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(rebuilt)}\n\n`),
                );
              }
              fnCallArgBuffer = "";
            }

            // Log rehydration summary for this streaming response
            if (tracker.count > 0) {
              writeLog(logFile, logLevel, "info", {
                timestamp: new Date().toISOString(),
                direction: "response",
                provider: provider.name,
                sessionId,
                rehydrated: tracker.count,
                channels: [...tracker.channels],
              });
              writeLog(logFile, logLevel, "debug", {
                timestamp: new Date().toISOString(),
                direction: "response",
                sessionId,
                rehydratedFragments: tracker.fragments,
              });
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
