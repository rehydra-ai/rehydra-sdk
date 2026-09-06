import { SSEParser, isSSEDone, serializeSSEEvent } from './sse-parser.js';
import type { StreamingToolLoopAdapter } from './providers/streaming-tool-loop.js';

/** Buffer one response with a byte limit and cancellation, including incomplete SSE events. */
export async function readToolResponse(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Tool response exceeds maxToolResponseBytes');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function accumulateToolStream(text: string, adapter: StreamingToolLoopAdapter): unknown {
  const parser = new SSEParser();
  const accumulator = adapter.createAccumulator();
  for (const event of [...parser.parse(text), ...parser.flush()]) {
    if (isSSEDone(event.data)) continue;
    accumulator.push(JSON.parse(event.data) as unknown);
  }
  return accumulator.finish();
}

/** Generate frames on demand so downstream consumption controls backpressure. */
export function toolResultStream(body: unknown, response: Response, adapter: StreamingToolLoopAdapter): Response {
  const frames = adapter.encode(body)[Symbol.iterator]();
  const encoder = new TextEncoder();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'text/event-stream');
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller): void {
      const next = frames.next();
      if (next.done === true) controller.close();
      else controller.enqueue(encoder.encode(serializeSSEEvent(next.value)));
    },
    cancel(): void { frames.return?.(); },
  }), { status: response.status, statusText: response.statusText, headers });
}
