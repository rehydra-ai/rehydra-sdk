/**
 * Rehydra Fetch Wrapper
 * Wraps the native fetch to anonymize outgoing LLM requests
 * and rehydrate incoming LLM responses.
 */

import { createAnonymizer } from "../core/anonymizer.js";
import { decryptPIIMap } from "../crypto/index.js";
import { rehydrate } from "../pipeline/tagger.js";
import type { RawPIIMap } from "../pipeline/tagger.js";
import { AnonymizerSessionImpl } from "../storage/session.js";
import { SSEParser, isSSEDone, serializeSSEEvent } from "./sse-parser.js";
import { detectProvider } from "./providers/index.js";
import type { LLMContentProvider } from "./providers/types.js";
import type { RehydraFetchConfig } from "./types.js";

let sessionCounter = 0;

function defaultGetSessionId(): string {
  return `rehydra-proxy-${Date.now()}-${++sessionCounter}`;
}

/**
 * Creates a fetch-compatible function that automatically:
 * 1. Anonymizes text in outgoing LLM API requests
 * 2. Rehydrates text in incoming LLM API responses
 *
 * PII never leaves your infrastructure.
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { createRehydraFetch, InMemoryKeyProvider, InMemoryPIIStorageProvider } from 'rehydra';
 *
 * const rehydraFetch = createRehydraFetch({
 *   keyProvider: new InMemoryKeyProvider(),
 *   piiStorageProvider: new InMemoryPIIStorageProvider(),
 * });
 *
 * const openai = new OpenAI({ fetch: rehydraFetch });
 *
 * // PII is automatically anonymized before being sent to OpenAI
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Email john@example.com about the meeting' }],
 * });
 * // Response is automatically rehydrated — contains original PII
 * ```
 */
export function createRehydraFetch(
  config: RehydraFetchConfig,
): typeof globalThis.fetch {
  const anonymizer = createAnonymizer({
    ...config.anonymizer,
    keyProvider: config.keyProvider,
    piiStorageProvider: config.piiStorageProvider,
  });
  let initialized = false;

  const getSessionId = config.getSessionId ?? defaultGetSessionId;
  const handleStreaming = config.handleStreaming !== false;

  async function ensureInitialized(): Promise<void> {
    if (!initialized) {
      await anonymizer.initialize();
      initialized = true;
    }
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    await ensureInitialized();

    const request = new Request(input, init);

    // Only intercept POST requests with JSON bodies (LLM API calls)
    if (request.method !== "POST") {
      return fetch(request);
    }

    const contentType = request.headers.get("content-type");
    if (contentType === null || !contentType.includes("application/json")) {
      return fetch(request);
    }

    // Detect the LLM provider
    const provider = detectProvider(
      request.url,
      request.headers,
      config.provider,
    );

    // Parse request body
    const body: unknown = await request.json();

    // Get session ID for PII map persistence
    const sessionId = await getSessionId(request);

    // Create a session for this request
    const session = new AnonymizerSessionImpl(
      anonymizer,
      sessionId,
      config.piiStorageProvider,
      config.keyProvider,
    );

    // Extract and anonymize text from the request
    const texts = provider.extractRequestText(body);
    const anonymizedTexts: string[] = [];

    for (const text of texts) {
      const result = await session.anonymize(text, config.locale, config.policy);
      anonymizedTexts.push(result.anonymizedText);
    }

    // Rebuild the request body with anonymized text
    const anonymizedBody = provider.rebuildRequestBody(body, anonymizedTexts);

    // Forward the anonymized request
    const upstreamRequest = new Request(request, {
      body: JSON.stringify(anonymizedBody),
    });

    const response = await fetch(upstreamRequest);

    // Determine if the response is a streaming SSE response
    const responseContentType = response.headers.get("content-type");
    const isSSE =
      handleStreaming &&
      provider.isStreamingRequest(body) &&
      responseContentType !== null &&
      responseContentType.includes("text/event-stream");

    if (isSSE && response.body !== null) {
      return rehydrateSSEResponse(response, session, provider, config);
    }

    return rehydrateJSONResponse(response, session, provider);
  };
}

/**
 * Rehydrate a non-streaming JSON response.
 */
async function rehydrateJSONResponse(
  response: Response,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
): Promise<Response> {
  const body: unknown = await response.json();

  // Extract response text and rehydrate
  const responseTexts = provider.extractResponseText(body);
  const rehydratedTexts: string[] = [];

  for (const text of responseTexts) {
    const rehydrated = await session.rehydrate(text);
    rehydratedTexts.push(rehydrated);
  }

  // Rebuild response body
  let rehydratedBody = provider.rebuildResponseBody(body, rehydratedTexts);

  // Rehydrate tool call arguments
  if (
    provider.extractResponseToolCalls !== undefined &&
    provider.rebuildResponseToolCalls !== undefined
  ) {
    const toolCallArgs = provider.extractResponseToolCalls(rehydratedBody);
    if (toolCallArgs.length > 0) {
      const rehydratedArgs: string[] = [];
      for (const arg of toolCallArgs) {
        const rehydrated = await session.rehydrate(arg);
        rehydratedArgs.push(rehydrated);
      }
      rehydratedBody = provider.rebuildResponseToolCalls(
        rehydratedBody,
        rehydratedArgs,
      );
    }
  }

  return new Response(JSON.stringify(rehydratedBody), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Rehydrate a streaming SSE response.
 * Returns a new Response with a transformed body stream.
 */
function rehydrateSSEResponse(
  response: Response,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
  config: RehydraFetchConfig,
): Response {
  const sseParser = new SSEParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Buffer for incomplete PII tags that span SSE chunks (content)
  let tagBuffer = "";

  // Per-index buffers for tool call argument fragments
  const toolCallBuffers = new Map<number, string>();
  // Last seen SSE event per tool call index (used as template during flush)
  const toolCallLastEvent = new Map<
    number,
    { sseEvent: string; parsed: unknown }
  >();

  // We load the PII map once, lazily
  let piiMapPromise: Promise<RawPIIMap> | null = null;

  function getPiiMap(): Promise<RawPIIMap> {
    if (piiMapPromise === null) {
      piiMapPromise = (async (): Promise<RawPIIMap> => {
        const stored = await config.piiStorageProvider.load(session.sessionId);
        if (stored === null) return new Map();
        const key = await config.keyProvider.getKey();
        return decryptPIIMap(stored.piiMap, key);
      })();
    }
    return piiMapPromise;
  }

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    async transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ): Promise<void> {
      const text = decoder.decode(chunk, { stream: true });
      const events = sseParser.parse(text);

      for (const event of events) {
        if (isSSEDone(event.data)) {
          controller.enqueue(encoder.encode(serializeSSEEvent(event)));
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          // Not JSON — pass through as-is
          controller.enqueue(encoder.encode(serializeSSEEvent(event)));
          continue;
        }

        // Try content delta first
        const delta = provider.extractSSEDelta(parsed);
        if (delta !== null) {
          // Handle incomplete PII tags spanning chunks
          const fullText = tagBuffer + delta;
          const incompleteTagIdx = fullText.lastIndexOf("<PII");
          const lastCloseIdx = fullText.lastIndexOf("/>");

          let textToRehydrate: string;
          if (
            incompleteTagIdx !== -1 &&
            (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)
          ) {
            textToRehydrate = fullText.slice(0, incompleteTagIdx);
            tagBuffer = fullText.slice(incompleteTagIdx);
          } else {
            textToRehydrate = fullText;
            tagBuffer = "";
          }

          if (textToRehydrate.length > 0) {
            const piiMap = await getPiiMap();
            const rehydrated = rehydrate(textToRehydrate, piiMap);
            const rebuilt = provider.rebuildSSEDelta(parsed, rehydrated);
            controller.enqueue(
              encoder.encode(
                serializeSSEEvent({
                  event: event.event,
                  data: JSON.stringify(rebuilt),
                }),
              ),
            );
          }
          continue;
        }

        // Try tool call deltas
        if (provider.extractSSEToolCallDeltas !== undefined && provider.rebuildSSEToolCallDeltas !== undefined) {
          const toolDeltas = provider.extractSSEToolCallDeltas(parsed);
          if (toolDeltas !== null && toolDeltas.length > 0) {
            const rehydratedArgs = new Map<number, string>();

            for (const td of toolDeltas) {
              toolCallLastEvent.set(td.index, {
                sseEvent: event.event,
                parsed,
              });
              const existing = toolCallBuffers.get(td.index) ?? "";
              const fullText = existing + td.arguments;

              const incompleteTagIdx = fullText.lastIndexOf("<PII");
              const lastCloseIdx = fullText.lastIndexOf("/>");

              let textToRehydrate: string;
              if (
                incompleteTagIdx !== -1 &&
                (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)
              ) {
                textToRehydrate = fullText.slice(0, incompleteTagIdx);
                toolCallBuffers.set(td.index, fullText.slice(incompleteTagIdx));
              } else {
                textToRehydrate = fullText;
                toolCallBuffers.set(td.index, "");
              }

              if (textToRehydrate.length > 0) {
                const piiMap = await getPiiMap();
                const rehydrated = rehydrate(textToRehydrate, piiMap);
                rehydratedArgs.set(td.index, rehydrated);
              }
            }

            if (rehydratedArgs.size > 0) {
              const rebuilt = provider.rebuildSSEToolCallDeltas(parsed, rehydratedArgs);
              controller.enqueue(
                encoder.encode(
                  serializeSSEEvent({
                    event: event.event,
                    data: JSON.stringify(rebuilt),
                  }),
                ),
              );
            }
            continue;
          }
        }

        // Check for tool call block stop — flush buffer before forwarding
        if (
          provider.extractSSEToolCallStop !== undefined &&
          provider.rebuildSSEToolCallDeltas !== undefined
        ) {
          const stopIndex = provider.extractSSEToolCallStop(parsed);
          if (stopIndex !== null) {
            const buffer = toolCallBuffers.get(stopIndex) ?? "";
            if (buffer.length > 0) {
              const piiMap = await getPiiMap();
              const rehydrated = rehydrate(buffer, piiMap);
              if (rehydrated.length > 0) {
                const last = toolCallLastEvent.get(stopIndex);
                if (last !== undefined) {
                  const rebuilt = provider.rebuildSSEToolCallDeltas(
                    last.parsed,
                    new Map([[stopIndex, rehydrated]]),
                  );
                  controller.enqueue(
                    encoder.encode(
                      serializeSSEEvent({
                        event: last.sseEvent,
                        data: JSON.stringify(rebuilt),
                      }),
                    ),
                  );
                }
              }
              toolCallBuffers.delete(stopIndex);
              toolCallLastEvent.delete(stopIndex);
            }
          }
        }

        // Pass through as-is
        controller.enqueue(encoder.encode(serializeSSEEvent(event)));
      }
    },

    async flush(
      controller: TransformStreamDefaultController<Uint8Array>,
    ): Promise<void> {
      const events = sseParser.flush();
      for (const event of events) {
        controller.enqueue(encoder.encode(serializeSSEEvent(event)));
      }

      if (tagBuffer.length > 0) {
        const piiMap = await getPiiMap();
        const rehydrated = rehydrate(tagBuffer, piiMap);
        if (rehydrated.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content: rehydrated })}\n\n`),
          );
        }
        tagBuffer = "";
      }

      // Flush remaining tool call buffers
      if (
        provider.rebuildSSEToolCallDeltas !== undefined
      ) {
        for (const [index, buffer] of toolCallBuffers) {
          if (buffer.length > 0) {
            const piiMap = await getPiiMap();
            const rehydrated = rehydrate(buffer, piiMap);
            if (rehydrated.length > 0) {
              const last = toolCallLastEvent.get(index);
              if (last !== undefined) {
                const rebuilt = provider.rebuildSSEToolCallDeltas(
                  last.parsed,
                  new Map([[index, rehydrated]]),
                );
                controller.enqueue(
                  encoder.encode(
                    serializeSSEEvent({
                      event: last.sseEvent,
                      data: JSON.stringify(rebuilt),
                    }),
                  ),
                );
              }
            }
          }
        }
        toolCallBuffers.clear();
        toolCallLastEvent.clear();
      }
    },
  });

  const transformedBody = response.body!.pipeThrough(transformStream);

  return new Response(transformedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
