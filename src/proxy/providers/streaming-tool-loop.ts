import type { SSEEvent } from '../sse-parser.js';

/** A provider-specific conversion between SSE and complete tool-loop responses. */
export interface StreamingToolLoopAdapter {
  createAccumulator(): { push(data: unknown): void; finish(): unknown };
  encode(body: unknown): Iterable<SSEEvent>;
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid streaming response object');
  }
  return value as ObjectValue;
}
function index(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid streaming response index');
  }
  return value;
}
function append(target: ObjectValue, key: string, value: unknown): void {
  if (typeof value === 'string') target[key] = String(target[key] ?? '') + value;
}
function event(data: unknown, type = 'message'): SSEEvent {
  return { event: type, data: JSON.stringify(data) };
}
function validateTool(id: unknown, name: unknown, args: string): void {
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') {
    throw new Error('Incomplete streamed tool call');
  }
  object(JSON.parse(args));
}

export const openAIStreamingToolLoop: StreamingToolLoopAdapter = {
  createAccumulator() {
    const metadata: ObjectValue = {};
    const message: ObjectValue = { role: 'assistant', content: '' };
    const calls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();
    let finishReason: unknown;
    return {
      push(data): void {
        const chunk = object(data);
        if (chunk.error !== undefined) throw new Error('Upstream streaming error');
        for (const key of ['id', 'model', 'created', 'system_fingerprint', 'usage']) {
          if (chunk[key] !== undefined) metadata[key] = chunk[key];
        }
        if (!Array.isArray(chunk.choices)) throw new Error('Missing streaming choices');
        for (const value of chunk.choices) {
          const choice = object(value);
          if (index(choice.index) !== 0) throw new Error('Streaming tool loops require a single completion choice');
          const delta = object(choice.delta);
          if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
          for (const key of ['content', 'refusal', 'reasoning_content']) append(message, key, delta[key]);
          if (Array.isArray(delta.tool_calls)) for (const item of delta.tool_calls) {
            const fragment = object(item);
            const i = index(fragment.index);
            const call = calls.get(i) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            append(call, 'id', fragment.id);
            if (fragment.function !== undefined) {
              const fn = object(fragment.function);
              append(call.function, 'name', fn.name);
              append(call.function, 'arguments', fn.arguments);
            }
            calls.set(i, call);
          }
        }
      },
      finish(): unknown {
        if (finishReason === undefined) throw new Error('Truncated streaming completion');
        if (calls.size > 0) {
          if (finishReason !== 'tool_calls') throw new Error('Streamed tool calls did not complete');
          const tools = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call);
          if (new Set(tools.map(call => call.id)).size !== tools.length) throw new Error('Duplicate streamed tool call ID');
          for (const call of tools) validateTool(call.id, call.function.name, call.function.arguments);
          message.tool_calls = tools;
        }
        return { ...metadata, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finishReason }] };
      },
    };
  },
  *encode(body) {
    const response = object(body);
    if (!Array.isArray(response.choices)) throw new Error('Missing completion choices');
    const metadata = { ...response, object: 'chat.completion.chunk', usage: undefined };
    for (const value of response.choices) {
      const choice = object(value);
      const message = object(choice.message);
      const delta = { ...message };
      if (Array.isArray(message.tool_calls)) delta.tool_calls = message.tool_calls.map((call, i) => ({ ...object(call), index: i }));
      yield event({ ...metadata, choices: [{ index: choice.index ?? 0, delta, finish_reason: null }] });
      yield event({ ...metadata, choices: [{ index: choice.index ?? 0, delta: {}, finish_reason: choice.finish_reason }] });
    }
    if (response.usage !== undefined) yield event({ ...metadata, choices: [], usage: response.usage });
    yield { event: 'message', data: '[DONE]' };
  },
};

export const anthropicStreamingToolLoop: StreamingToolLoopAdapter = {
  createAccumulator() {
    let message: ObjectValue | undefined;
    const blocks = new Map<number, ObjectValue>();
    const args = new Map<number, string>();
    const stoppedBlocks = new Set<number>();
    let stopped = false;
    return {
      push(data): void {
        const value = object(data);
        if (value.type === 'error') throw new Error('Upstream streaming error');
        switch (value.type) {
          case 'message_start':
            if (message !== undefined) throw new Error('Duplicate message start');
            message = { ...object(value.message) }; break;
          case 'content_block_start': {
            const i = index(value.index);
            if (blocks.has(i)) throw new Error('Duplicate content block');
            blocks.set(i, { ...object(value.content_block) });
            break;
          }
          case 'content_block_delta': {
            const i = index(value.index);
            const block = blocks.get(i);
            if (block === undefined || stoppedBlocks.has(i)) throw new Error('Unexpected content delta');
            const delta = object(value.delta);
            if (delta.type === 'input_json_delta') {
              if (typeof delta.partial_json !== 'string') throw new Error('Invalid tool argument delta');
              args.set(i, (args.get(i) ?? '') + delta.partial_json);
            } else if (delta.type === 'text_delta') append(block, 'text', delta.text);
            else if (delta.type === 'thinking_delta') append(block, 'thinking', delta.thinking);
            else if (delta.type === 'signature_delta') append(block, 'signature', delta.signature);
            else throw new Error('Unsupported content delta in streaming tool loop');
            break;
          }
          case 'content_block_stop': {
            const i = index(value.index);
            if (!blocks.has(i) || stoppedBlocks.has(i)) throw new Error('Unexpected content block stop');
            stoppedBlocks.add(i); break;
          }
          case 'message_delta':
            if (message === undefined) throw new Error('Missing message start');
            Object.assign(message, object(value.delta));
            if (value.usage !== undefined) message.usage = { ...object(message.usage ?? {}), ...object(value.usage) };
            break;
          case 'message_stop': stopped = true; break;
        }
      },
      finish(): unknown {
        if (message === undefined || !stopped) throw new Error('Truncated streaming message');
        const content = [...blocks].sort(([a], [b]) => a - b).map(([i, block]) => {
          if (!stoppedBlocks.has(i)) throw new Error('Unfinished content block');
          if (block.type === 'tool_use') {
            if (message!.stop_reason !== 'tool_use') throw new Error('Streamed tool calls did not complete');
            const json = args.get(i) ?? JSON.stringify(block.input ?? {});
            validateTool(block.id, block.name, json);
            block.input = JSON.parse(json) as unknown;
          }
          return block;
        });
        const ids = content.filter(block => block.type === 'tool_use').map(block => block.id);
        if (new Set(ids).size !== ids.length) throw new Error('Duplicate streamed tool call ID');
        return { ...message, content };
      },
    };
  },
  *encode(body) {
    const response = object(body);
    if (!Array.isArray(response.content)) throw new Error('Missing message content');
    yield event({ type: 'message_start', message: { ...response, content: [], stop_reason: null, stop_sequence: null } }, 'message_start');
    for (const [i, item] of response.content.entries()) {
      const block = object(item);
      const start = { ...block };
      const deltas: ObjectValue[] = [];
      if (block.type === 'text') { start.text = ''; deltas.push({ type: 'text_delta', text: block.text }); }
      if (block.type === 'tool_use') { start.input = {}; deltas.push({ type: 'input_json_delta', partial_json: JSON.stringify(block.input) }); }
      if (block.type === 'thinking') {
        start.thinking = ''; start.signature = '';
        deltas.push({ type: 'thinking_delta', thinking: block.thinking });
        if (typeof block.signature === 'string') deltas.push({ type: 'signature_delta', signature: block.signature });
      }
      yield event({ type: 'content_block_start', index: i, content_block: start }, 'content_block_start');
      for (const delta of deltas) yield event({ type: 'content_block_delta', index: i, delta }, 'content_block_delta');
      yield event({ type: 'content_block_stop', index: i }, 'content_block_stop');
    }
    yield event({ type: 'message_delta', delta: { stop_reason: response.stop_reason, stop_sequence: response.stop_sequence }, usage: response.usage ?? {} }, 'message_delta');
    yield event({ type: 'message_stop' }, 'message_stop');
  },
};
