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
import type { LLMContentProvider, ToolResultMessage } from "./providers/types.js";
import type { RehydraFetchConfig } from "./types.js";
import { buildPIISystemInstruction } from "./system-instruction.js";
import { buildTagPrefix } from "../utils/regex.js";
import { accumulateToolStream, readToolResponse, toolResultStream } from "./tool-loop-stream.js";
import { DEFAULT_TAG_FORMAT } from "../types/index.js";

/** Headers to strip from proxied responses — the body is decompressed and may be modified. */
const STRIP_RESPONSE_HEADERS = ["content-encoding", "content-length"];

function stripResponseHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);
  for (const h of STRIP_RESPONSE_HEADERS) {
    cleaned.delete(h);
  }
  return cleaned;
}

/**
 * Returns the length of the longest proper prefix of `tagPrefix` that `text`
 * ends with, or 0 if none. Used to hold back a partially-streamed tag prefix
 * (e.g. a chunk ending in `"<P"` or `"<PI"`) so it isn't forwarded raw before
 * the rest of the `<PII.../>` tag arrives in a later SSE chunk.
 */
function trailingPartialTagPrefixLen(text: string, tagPrefix: string): number {
  for (let n = tagPrefix.length - 1; n >= 1; n--) {
    if (text.endsWith(tagPrefix.slice(0, n))) return n;
  }
  return 0;
}

let sessionCounter = 0;

function defaultGetSessionId(): string {
  return `rehydra-proxy-${Date.now()}-${++sessionCounter}`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: { message, type: "rehydra_proxy_error" },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
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
  if (config.maxToolRounds !== undefined &&
    (!Number.isSafeInteger(config.maxToolRounds) || config.maxToolRounds < 0)) {
    throw new Error("maxToolRounds must be a nonnegative safe integer");
  }
  if (config.maxToolResponseBytes !== undefined &&
    (!Number.isSafeInteger(config.maxToolResponseBytes) || config.maxToolResponseBytes <= 0)) {
    throw new Error("maxToolResponseBytes must be a positive safe integer");
  }
  const anonymizer = createAnonymizer({
    ...config.anonymizer,
    keyProvider: config.keyProvider,
    piiStorageProvider: config.piiStorageProvider,
  });
  let initialized = false;
  const tagFormat = config.anonymizer?.tagFormat ?? DEFAULT_TAG_FORMAT;

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
    try {
      await ensureInitialized();
    } catch (err) {
      initialized = false; // Allow retry on next request
      const msg =
        err instanceof Error ? err.message : "Initialization failed";
      return errorResponse(503, `Rehydra proxy not ready: ${msg}`);
    }

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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "Invalid JSON in request body");
    }

    // Get session ID for PII map persistence
    const sessionId = await getSessionId(request);

    // Create a session for this request
    const session = new AnonymizerSessionImpl(
      anonymizer,
      sessionId,
      config.piiStorageProvider,
      config.keyProvider,
    );

    try {
      // Extract and anonymize text from the request
      const texts = provider.extractRequestText(body);
      const anonymizedTexts: string[] = [];
      let piiDetected = false;
      const countsByType: Record<string, number> = {};
      let totalEntities = 0;

      for (let i = 0; i < texts.length; i++) {
        const result = await session.anonymize(
          texts[i]!,
          config.locale,
          config.policy,
        );
        anonymizedTexts.push(result.anonymizedText);
        if (result.anonymizedText !== texts[i]) {
          piiDetected = true;
        }
        for (const [type, count] of Object.entries(result.stats.countsByType)) {
          if (count > 0) {
            countsByType[type] = (countsByType[type] ?? 0) + count;
            totalEntities += count;
          }
        }
      }

      // Report what was anonymized (types and counts only — never raw PII)
      if (config.onAnonymize !== undefined) {
        config.onAnonymize({
          method: request.method,
          url: request.url,
          countsByType,
          totalEntities,
        });
      }

      // Rebuild the request body with anonymized text
      let anonymizedBody = provider.rebuildRequestBody(body, anonymizedTexts);

      // Inject PII handling instruction when anonymization replaced something.
      // Can be disabled with systemInstruction: false, or overridden with a custom string.
      if (
        piiDetected &&
        config.systemInstruction !== false &&
        provider.injectSystemInstruction !== undefined
      ) {
        const instruction =
          typeof config.systemInstruction === "string"
            ? config.systemInstruction
            : buildPIISystemInstruction(tagFormat);
        anonymizedBody = provider.injectSystemInstruction(
          anonymizedBody,
          instruction,
        );
      }

      // Forward the anonymized request
      const upstreamRequest = new Request(request, {
        body: JSON.stringify(anonymizedBody),
      });

      let response: Response;
      try {
        response = await fetch(upstreamRequest);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Upstream request failed";
        return errorResponse(502, `Upstream LLM unreachable: ${msg}`);
      }

      if (!response.ok) return response;

      // Determine if the response is a streaming SSE response
      const responseContentType = response.headers.get("content-type");
      const isSSE =
        handleStreaming &&
        provider.isStreamingRequest(body) &&
        responseContentType !== null &&
        responseContentType.includes("text/event-stream");

      if (isSSE && response.body !== null) {
        if (config.onToolCall !== undefined && provider.streamingToolLoop !== undefined &&
          provider.hasResponseToolCalls !== undefined && provider.extractResponseToolCallInfo !== undefined &&
          provider.extractMessages !== undefined && provider.buildToolLoopBody !== undefined && response.ok) {
          return await handleStreamingToolLoop(response, anonymizedBody, session, provider, config, request);
        }
        return rehydrateSSEResponse(response, session, provider, config);
      }

      // Tool execution loop: when onToolCall is configured and provider
      // supports it, intercept tool call responses and run them server-side
      if (
        config.onToolCall !== undefined &&
        provider.hasResponseToolCalls !== undefined &&
        provider.extractResponseToolCallInfo !== undefined &&
        provider.extractMessages !== undefined &&
        provider.buildToolLoopBody !== undefined
      ) {
        return await handleToolLoop(
          response,
          anonymizedBody,
          session,
          provider,
          config,
          request,
        );
      }

      return rehydrateJSONResponse(response, session, provider);
    } catch (err) {
      if (request.signal.aborted) throw err;
      const msg =
        err instanceof Error ? err.message : "Internal proxy error";
      return errorResponse(500, msg);
    }
  };
}

/** Buffer and validate the first stream before allowing any tool side effects. */
async function handleStreamingToolLoop(
  response: Response,
  anonymizedBody: unknown,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
  config: RehydraFetchConfig,
  request: Request,
): Promise<Response> {
  const adapter = provider.streamingToolLoop!;
  let text: string;
  let complete: unknown;
  try {
    text = await readToolResponse(response, config.maxToolResponseBytes ?? 8 * 1024 * 1024, request.signal);
    complete = accumulateToolStream(text, adapter);
  } catch (err) {
    if (request.signal.aborted) throw err;
    return errorResponse(502, err instanceof Error ? err.message : "Invalid streamed tool response");
  }
  if (!provider.hasResponseToolCalls!(complete)) {
    return rehydrateSSEResponse(new Response(text, {
      status: response.status, headers: stripResponseHeaders(response.headers),
    }), session, provider, config);
  }
  const headers = stripResponseHeaders(response.headers);
  headers.set("content-type", "application/json");
  const finalResponse = await handleToolLoop(new Response(JSON.stringify(complete), {
    status: response.status, headers,
  }), anonymizedBody, session, provider, config, request);
  if (!finalResponse.ok) return finalResponse;
  let finalBody: unknown;
  try {
    finalBody = await finalResponse.json();
  } catch {
    return errorResponse(502, "Invalid JSON in tool-loop response");
  }
  return toolResultStream(finalBody, finalResponse, adapter);
}

/**
 * Rehydrate a non-streaming JSON response.
 */
async function rehydrateJSONResponse(
  response: Response,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
): Promise<Response> {
  // Read raw text so we can fall back to it if JSON parsing fails
  const rawText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    // Upstream returned invalid JSON — pass through unchanged
    return new Response(rawText, {
      status: response.status,
      statusText: response.statusText,
      headers: stripResponseHeaders(response.headers),
    });
  }

  return rehydrateJSONResponseFromBody(body, response, session, provider);
}

/**
 * Rehydrate a pre-parsed JSON response body.
 */
async function rehydrateJSONResponseFromBody(
  body: unknown,
  response: Response,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
): Promise<Response> {
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
 * Handle multi-round tool execution loop.
 *
 * When the LLM returns tool calls, this function:
 * 1. Rehydrates tool call arguments (restores real PII)
 * 2. Calls the user's onToolCall callback for each tool call
 * 3. Anonymizes the result
 * 4. Appends assistant + tool result messages to the conversation
 * 5. Sends the next request (without re-anonymizing existing messages)
 * 6. Repeats until the LLM returns a final response or maxToolRounds is hit
 */
async function handleToolLoop(
  initialResponse: Response,
  anonymizedBody: unknown,
  session: AnonymizerSessionImpl,
  provider: LLMContentProvider,
  config: RehydraFetchConfig,
  originalRequest: Request,
): Promise<Response> {
  const maxRounds = config.maxToolRounds ?? 10;

  // Parse the initial response
  const readResponse = (response: Response): Promise<string> =>
    readToolResponse(response, config.maxToolResponseBytes ?? 8 * 1024 * 1024, originalRequest.signal);
  const rawText = await readResponse(initialResponse);
  let currentResponse: unknown;
  try {
    currentResponse = JSON.parse(rawText);
  } catch {
    return new Response(rawText, {
      status: initialResponse.status,
      statusText: initialResponse.statusText,
      headers: stripResponseHeaders(initialResponse.headers),
    });
  }

  // If the first response doesn't have tool calls, just rehydrate normally
  if (!provider.hasResponseToolCalls!(currentResponse)) {
    return rehydrateJSONResponseFromBody(
      currentResponse,
      initialResponse,
      session,
      provider,
    );
  }

  // Track the anonymized messages array across rounds
  let currentMessages = provider.extractMessages!(anonymizedBody);
  let lastUpstreamResponse = initialResponse;
  let round = 0;

  while (
    round < maxRounds &&
    provider.hasResponseToolCalls!(currentResponse)
  ) {
    round++;

    // Extract tool call details (arguments are still in anonymized form)
    const toolCallInfos =
      provider.extractResponseToolCallInfo!(currentResponse);

    // Rehydrate arguments and invoke the user's callback
    const toolResults: ToolResultMessage[] = [];
    for (const tc of toolCallInfos) {
      // Rehydrate the arguments string to restore real PII
      originalRequest.signal.throwIfAborted();
      let parsedArgs: Record<string, unknown>;
      try {
        const args = JSON.parse(tc.arguments) as Record<string, unknown>;
        parsedArgs = await session.rehydrateJson(args);
      } catch {
        parsedArgs = { raw: await session.rehydrate(tc.arguments) };
      }
      originalRequest.signal.throwIfAborted();

      // Call the user's tool handler with real PII
      const result = await config.onToolCall!(tc.name, parsedArgs, tc.id);

      // Anonymize the result using the same session (maintains PII ID continuity)
      originalRequest.signal.throwIfAborted();
      const anonymizedResult = await session.anonymizeJson(result, config.locale, config.policy);

      toolResults.push({
        toolCallId: tc.id,
        content:
          typeof anonymizedResult === "string"
            ? anonymizedResult
            : JSON.stringify(anonymizedResult),
      });
    }

    // Anonymize the assistant's tool call arguments before appending.
    // The LLM may have generated real-looking PII in tool_use inputs
    // instead of echoing back the PII tags it received.
    let sanitizedResponse = currentResponse;
    if (
      provider.extractResponseToolCalls !== undefined &&
      provider.rebuildResponseToolCalls !== undefined
    ) {
      const rawArgs = provider.extractResponseToolCalls(currentResponse);
      if (rawArgs.length > 0) {
        const anonymizedArgs: string[] = [];
        for (const arg of rawArgs) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(arg);
          } catch {
            parsed = arg;
          }
          const anonymized = await session.anonymizeJson(parsed);
          anonymizedArgs.push(
            typeof anonymized === "string"
              ? anonymized
              : JSON.stringify(anonymized),
          );
        }
        sanitizedResponse = provider.rebuildResponseToolCalls(
          currentResponse,
          anonymizedArgs,
        );
      }
    }

    // Build the next request body (no re-anonymization — messages are already anonymized)
    const nextBody = provider.buildToolLoopBody!(
      anonymizedBody,
      currentMessages,
      sanitizedResponse,
      toolResults,
    );

    // Update message array for next round
    currentMessages = provider.extractMessages!(nextBody);

    // Send the next request to the LLM
    const nextRequest = new Request(originalRequest, {
      body: JSON.stringify(nextBody),
    });

    let nextResponse: Response;
    try {
      nextResponse = await fetch(nextRequest);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Upstream request failed";
      return errorResponse(502, `Upstream LLM unreachable: ${msg}`);
    }

    lastUpstreamResponse = nextResponse;

    // Parse the new response
    const nextRawText = await readResponse(nextResponse);
    if (!nextResponse.ok) return new Response(nextRawText, {
      status: nextResponse.status, statusText: nextResponse.statusText,
      headers: stripResponseHeaders(nextResponse.headers),
    });
    try {
      currentResponse = JSON.parse(nextRawText);
    } catch {
      return new Response(nextRawText, {
        status: nextResponse.status,
        statusText: nextResponse.statusText,
        headers: stripResponseHeaders(nextResponse.headers),
      });
    }
  }

  // Rehydrate and return the final response
  return rehydrateJSONResponseFromBody(
    currentResponse,
    lastUpstreamResponse,
    session,
    provider,
  );
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
  const tagFormat = config.anonymizer?.tagFormat ?? DEFAULT_TAG_FORMAT;
  const tagPrefix = buildTagPrefix(tagFormat);

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

        // Process content delta and tool call deltas from this event.
        // In practice, LLM APIs send one or the other per event, but we
        // handle both defensively by chaining rebuilds on the same parsed data.
        let handled = false;
        let rebuiltData: unknown = parsed;

        // Content delta
        const delta = provider.extractSSEDelta(parsed);
        if (delta !== null) {
          handled = true;
          const fullText = tagBuffer + delta;
          const incompleteTagIdx = fullText.lastIndexOf(tagPrefix);
          const lastCloseIdx = fullText.lastIndexOf(tagFormat.close);

          let textToRehydrate: string;
          if (
            incompleteTagIdx !== -1 &&
            (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)
          ) {
            textToRehydrate = fullText.slice(0, incompleteTagIdx);
            tagBuffer = fullText.slice(incompleteTagIdx);
          } else {
            const partialLen = trailingPartialTagPrefixLen(fullText, tagPrefix);
            textToRehydrate = fullText.slice(0, fullText.length - partialLen);
            tagBuffer = fullText.slice(fullText.length - partialLen);
          }

          if (textToRehydrate.length > 0) {
            const piiMap = await getPiiMap();
            const rehydrated = rehydrate(textToRehydrate, piiMap, false, tagFormat);
            rebuiltData = provider.rebuildSSEDelta(rebuiltData, rehydrated);
          }
        }

        // Tool call deltas
        if (provider.extractSSEToolCallDeltas !== undefined && provider.rebuildSSEToolCallDeltas !== undefined) {
          const toolDeltas = provider.extractSSEToolCallDeltas(parsed);
          if (toolDeltas !== null && toolDeltas.length > 0) {
            handled = true;
            const rehydratedArgs = new Map<number, string>();

            for (const td of toolDeltas) {
              toolCallLastEvent.set(td.index, {
                sseEvent: event.event,
                parsed,
              });
              const existing = toolCallBuffers.get(td.index) ?? "";
              const fullText = existing + td.arguments;

              const incompleteTagIdx = fullText.lastIndexOf(tagPrefix);
              const lastCloseIdx = fullText.lastIndexOf(tagFormat.close);

              let textToRehydrate: string;
              if (
                incompleteTagIdx !== -1 &&
                (lastCloseIdx === -1 || lastCloseIdx < incompleteTagIdx)
              ) {
                textToRehydrate = fullText.slice(0, incompleteTagIdx);
                toolCallBuffers.set(td.index, fullText.slice(incompleteTagIdx));
              } else {
                const partialLen = trailingPartialTagPrefixLen(
                  fullText,
                  tagPrefix,
                );
                textToRehydrate = fullText.slice(0, fullText.length - partialLen);
                toolCallBuffers.set(
                  td.index,
                  fullText.slice(fullText.length - partialLen),
                );
              }

              if (textToRehydrate.length > 0) {
                const piiMap = await getPiiMap();
                const rehydrated = rehydrate(textToRehydrate, piiMap, false, tagFormat);
                rehydratedArgs.set(td.index, rehydrated);
              }
            }

            if (rehydratedArgs.size > 0) {
              rebuiltData = provider.rebuildSSEToolCallDeltas(
                rebuiltData,
                rehydratedArgs,
              );
            }
          }
        }

        if (handled) {
          if (rebuiltData !== parsed) {
            controller.enqueue(
              encoder.encode(
                serializeSSEEvent({
                  event: event.event,
                  data: JSON.stringify(rebuiltData),
                }),
              ),
            );
          }
          continue;
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
              const rehydrated = rehydrate(buffer, piiMap, false, tagFormat);
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
        const rehydrated = rehydrate(tagBuffer, piiMap, false, tagFormat);
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
            const rehydrated = rehydrate(buffer, piiMap, false, tagFormat);
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
