import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRehydraFetch } from '../../src/proxy/rehydra-fetch.js';
import { InMemoryKeyProvider } from '../../src/crypto/index.js';
import { InMemoryPIIStorageProvider } from '../../src/storage/in-memory.js';
import { SSEParser, isSSEDone } from '../../src/proxy/sse-parser.js';
import type { RehydraFetchConfig } from '../../src/proxy/types.js';
import { anthropicStreamingToolLoop, openAIStreamingToolLoop } from '../../src/proxy/providers/streaming-tool-loop.js';

const email = 'alice@example.com';
const frames = (values: unknown[]): string => values.map(v => `data: ${typeof v === 'string' ? v : JSON.stringify(v)}\n\n`).join('');
function sse(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({ pull(c) {
    if (offset === bytes.length) { c.close(); return; }
    c.enqueue(bytes.slice(offset, offset + 3)); offset = Math.min(bytes.length, offset + 3);
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'trace' } });
}
function openaiCalls(arg: string): unknown[] {
  return [
    { id: 'c1', model: 'model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [
      { index: 0, id: 'tool-0', type: 'function', function: { name: 'lookup', arguments: arg.slice(0, 9) } },
      { index: 1, id: 'tool-1', type: 'function', function: { name: 'lookup', arguments: arg.slice(0, 4) } },
    ] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: arg.slice(4) } }, { index: 0, function: { arguments: arg.slice(9) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ];
}
function anthropicCalls(arg: string): unknown[] {
  return [
    { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'model', type: 'message', usage: { input_tokens: 12 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-0', name: 'lookup', input: {} } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: arg.slice(0, 4) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: arg } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: arg.slice(4) } },
    { type: 'content_block_stop', index: 0 }, { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
}
function client(overrides: Partial<RehydraFetchConfig> = {}) {
  return createRehydraFetch({ keyProvider: new InMemoryKeyProvider(), piiStorageProvider: new InMemoryPIIStorageProvider(), ...overrides });
}
function request(provider: 'openai' | 'anthropic', signal?: AbortSignal) {
  return new Request(`https://example.test/${provider}`, { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'model', stream: true,
      messages: [{ role: 'user', content: email }],
    }),
  });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe.each(['openai', 'anthropic'] as const)('%s streaming tool loops', (provider) => {
  const calls = provider === 'openai' ? openaiCalls : anthropicCalls;
  const adapter = provider === 'openai' ? openAIStreamingToolLoop : anthropicStreamingToolLoop;

  it('executes interleaved calls, scrubs new tool results, and returns a rehydrated SSE response', async () => {
    const onToolCall = vi.fn().mockResolvedValue({ email: 'bob@example.com' });
    let round = 0;
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      const text = await req.text();
      const body = JSON.parse(text);
      expect(text).not.toContain(email);
      expect(text).not.toContain('bob@example.com');
      if (round++ === 0) {
        expect(body.stream).toBe(true);
        const masked = body.messages.find((m: {role: string}) => m.role === 'user').content;
        return sse(frames(calls(JSON.stringify({ email: masked }))));
      }
      expect(body.stream).toBe(false);
      const tool = body.messages.at(-1);
      const result = JSON.parse(provider === 'openai' ? tool.content : tool.content[0].content);
      return Response.json(provider === 'openai'
        ? { id: 'final', model: 'model', choices: [{ index: 0, message: { role: 'assistant', content: result.email }, finish_reason: 'stop' }], usage: { completion_tokens: 7 } }
        : { id: 'final', type: 'message', role: 'assistant', model: 'model', content: [{ type: 'text', text: result.email }], stop_reason: 'end_turn', usage: { output_tokens: 7 } });
    }));
    const response = await client({ provider, onToolCall })(request(provider));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(onToolCall.mock.calls).toEqual([['lookup', { email }, 'tool-0'], ['lookup', { email }, 'tool-1']]);
    const wire = await response.text();
    expect(wire).toContain('bob@example.com');
    expect(wire).not.toContain('<PII');
    const acc = adapter.createAccumulator();
    for (const frame of new SSEParser().parse(wire)) if (!isSSEDone(frame.data)) acc.push(JSON.parse(frame.data));
    expect(JSON.stringify(acc.finish())).toContain('bob@example.com');
  });

  it('returns pending calls as SSE when the round budget is zero', async () => {
    const onToolCall = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sse(frames(calls(JSON.stringify({ email }))))));
    const response = await client({ provider, onToolCall, maxToolRounds: 0 })(request(provider));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toContain('lookup');
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('refuses truncated calls without executing a callback', async () => {
    const onToolCall = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sse(frames(calls('{"email":"test"}').slice(0, 2)))));
    expect((await client({ provider, onToolCall })(request(provider))).status).toBe(502);
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('refuses malformed tool arguments without executing a callback', async () => {
    const onToolCall = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sse(frames(calls('{broken')))));
    expect((await client({ provider, onToolCall })(request(provider))).status).toBe(502);
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('bounds buffered response bytes', async () => {
    const onToolCall = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sse(frames(calls('{}')))));
    const response = await client({ provider, onToolCall, maxToolResponseBytes: 32 })(request(provider));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('maxToolResponseBytes');
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('preserves upstream HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'rate limit' }, { status: 429 })));
    const response = await client({ provider, onToolCall: vi.fn() })(request(provider));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate limit' });
  });

  it('cancels an unfinished stream without executing tools', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const onToolCall = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => {
      setTimeout(() => abort.abort(), 10);
      return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    await expect(client({ provider, onToolCall })(request(provider, abort.signal))).rejects.toThrow();
    expect(cancel).toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });
});

it('preserves no-tool SSE metadata and rehydrates its content', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse(frames([
    { id: 'original', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 9 } }, '[DONE]',
  ]))));
  const callback = vi.fn();
  const response = await client({ provider: 'openai', onToolCall: callback })(request('openai'));
  expect(response.headers.get('x-request-id')).toBe('trace');
  const wire = await response.text();
  expect(wire).toContain('original'); expect(wire).toContain('total_tokens');
  expect(callback).not.toHaveBeenCalled();
});

it('does not run the next tool after cancellation during a callback', async () => {
  const abort = new AbortController();
  const callback = vi.fn(async () => { abort.abort(); return 'done'; });
  vi.stubGlobal('fetch', vi.fn(async () => sse(frames(openaiCalls('{}')))));
  await expect(client({ provider: 'openai', onToolCall: callback })(request('openai', abort.signal))).rejects.toThrow();
  expect(callback).toHaveBeenCalledTimes(1);
});

it('preserves later-round HTTP failures', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(sse(frames(openaiCalls('{}'))))
    .mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 })));
  const response = await client({ provider: 'openai', onToolCall: async () => 'result' })(request('openai'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'unavailable' });
});

it('executes multiple rounds and strips stream_options from JSON continuation requests', async () => {
  let round = 0;
  vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
    const body = await req.json();
    if (round++ === 0) return sse(frames(openaiCalls('{}')));
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
    if (round === 2) return Response.json({ choices: [{ message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'third', type: 'function', function: { name: 'again', arguments: '{}' } }],
    }, finish_reason: 'tool_calls' }] });
    return Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'finished' }, finish_reason: 'stop' }] });
  }));
  const callback = vi.fn().mockResolvedValue('ok');
  const req = request('openai');
  const body = await req.json();
  const response = await client({ provider: 'openai', onToolCall: callback })(new Request(req, { body: JSON.stringify({ ...body, stream_options: { include_usage: true } }) }));
  expect(callback).toHaveBeenCalledTimes(3);
  expect(await response.text()).toContain('finished');
});

it('rehydrates JSON string values without breaking quotes in tool arguments', async () => {
  const secret = 'a "quoted" value';
  vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
    const body = await req.json();
    if (body.stream) {
      const value = body.messages.find((m: {role: string}) => m.role === 'user').content;
      return sse(frames(openaiCalls(JSON.stringify({ value }))));
    }
    return Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] });
  }));
  const callback = vi.fn().mockResolvedValue('ok');
  const req = request('openai');
  const body = await req.json();
  body.messages[0].content = secret;
  const response = await client({ provider: 'openai', onToolCall: callback,
    anonymizer: { secrets: { enabled: true, redactValues: [secret] } },
  })(new Request(req, { body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  expect(callback.mock.calls[0]![1]).toEqual({ value: secret });
});

it('reports local callback failures as server errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse(frames(openaiCalls('{}')))));
  const response = await client({ provider: 'openai', onToolCall: async () => { throw new Error('callback failed'); } })(request('openai'));
  expect(response.status).toBe(500);
});

it.each([NaN, -1, 0, 1.5, Infinity])('rejects invalid buffer limits: %s', (limit) => {
  expect(() => client({ maxToolResponseBytes: limit })).toThrow('maxToolResponseBytes');
});

it('rejects an upstream SSE error before running any tools', async () => {
  const onToolCall = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => sse(frames([{ error: { message: 'upstream error' } }]))));
  expect((await client({ provider: 'openai', onToolCall })(request('openai'))).status).toBe(502);
  expect(onToolCall).not.toHaveBeenCalled();
});

it('retains Anthropic thinking and signature blocks for the tool continuation', () => {
  const acc = anthropicStreamingToolLoop.createAccumulator();
  const messages = anthropicCalls('{}');
  for (const value of messages.slice(0, -2)) acc.push(value);
  acc.push({ type: 'content_block_start', index: 2, content_block: { type: 'thinking', thinking: '', signature: '' } });
  acc.push({ type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: 'thinking' } });
  acc.push({ type: 'content_block_delta', index: 2, delta: { type: 'signature_delta', signature: 'signature' } });
  acc.push({ type: 'content_block_stop', index: 2 });
  for (const value of messages.slice(-2)) acc.push(value);
  expect(JSON.stringify(acc.finish())).toContain('"thinking":"thinking","signature":"signature"');
});
