import test from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, createStreamTranslator } from './stream.js';

interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Parse the Anthropic SSE text produced by the translator back into events. */
function parse(sseText: string): ParsedEvent[] {
  return sseText
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine!.replace('event: ', ''),
        data: JSON.parse(dataLine!.replace('data: ', '')) as Record<string, unknown>,
      };
    });
}

test('text-only stream: start, one text block, delta, stop, usage in message_delta', () => {
  const t = createStreamTranslator('groq/qwen/qwen3.6-27b');
  let out = t.push({ id: 'c1', choices: [{ delta: { content: 'Hel' } }] });
  out += t.push({ choices: [{ delta: { content: 'lo' } }] });
  out += t.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  out += t.push({ choices: [], usage: { prompt_tokens: 29631, completion_tokens: 2 } });
  out += t.end();
  const events = parse(out);
  assert.deepEqual(
    events.map((e) => e.event),
    ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'],
  );
  const startMsg = events[0]!.data.message as { model: string };
  assert.equal(startMsg.model, 'groq/qwen/qwen3.6-27b');
  const delta = events[5]!.data as { delta: { stop_reason: string }; usage: { input_tokens: number; output_tokens: number } };
  assert.equal(delta.delta.stop_reason, 'end_turn');
  assert.deepEqual(delta.usage, { input_tokens: 29631, output_tokens: 2 });
});

test('tool call stream: text block closes, tool_use is emitted complete at the end', () => {
  const t = createStreamTranslator('m');
  let out = t.push({ id: 'c2', choices: [{ delta: { content: 'Let me look. ' } }] });
  out += t.push({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'Bash', arguments: '' } }] } }],
  });
  out += t.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] } }] });
  out += t.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } }] });
  out += t.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
  out += t.end();
  const events = parse(out);
  assert.deepEqual(
    events.map((e) => e.event),
    [
      'message_start',
      'content_block_start', // text
      'content_block_delta',
      'content_block_stop', // text closed by the first tool delta
      'content_block_start', // tool_use, emitted by end()
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
  const toolStart = events[4]!.data as { index: number; content_block: { type: string; id: string; name: string } };
  assert.equal(toolStart.index, 1);
  assert.deepEqual(toolStart.content_block, { type: 'tool_use', id: 'call_9', name: 'Bash', input: {} });
  const argDelta = events[5]!.data as { index: number; delta: { type: string; partial_json: string } };
  assert.deepEqual(argDelta, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } });
  const msgDelta = events[7]!.data as { delta: { stop_reason: string } };
  assert.equal(msgDelta.delta.stop_reason, 'tool_use');
});

test('parallel tool calls map to distinct block indexes', () => {
  const t = createStreamTranslator('m');
  let out = t.push({
    id: 'c3',
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{}' } }] } }],
  });
  out += t.push({
    choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'Grep', arguments: '{}' } }] } }],
  });
  out += t.end();
  const events = parse(out);
  const starts = events.filter((e) => e.event === 'content_block_start');
  assert.equal(starts.length, 2);
  assert.equal((starts[0]!.data as { index: number }).index, 0);
  assert.equal((starts[1]!.data as { index: number }).index, 1);
});

test('interleaved parallel tool arguments stay complete and sequential', () => {
  const t = createStreamTranslator('m');
  let out = t.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{"p":' } }] } }] });
  out += t.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'Grep', arguments: '{"q":' } }] } }] });
  out += t.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] });
  out += t.push({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '2}' } }] } }] });
  out += t.end();
  const events = parse(out);
  const deltas = events.filter((e) => e.event === 'content_block_delta');
  assert.deepEqual(deltas.map((d) => (d.data as { delta: { partial_json: string } }).delta.partial_json), ['{"p":1}', '{"q":2}']);
  const toolStarts = events.filter((e) => e.event === 'content_block_start');
  assert.equal(toolStarts.length, 2);
  // No delta may target a block after its stop.
  const stopped = new Set<number>();
  for (const event of events) {
    const index = (event.data as { index?: number }).index;
    if (event.event === 'content_block_stop' && index !== undefined) stopped.add(index);
    if (event.event === 'content_block_delta' && index !== undefined) assert.equal(stopped.has(index), false);
  }
});

test('Groq x_groq.usage is reported in message_delta', () => {
  const t = createStreamTranslator('m');
  let out = t.push({ id: 'c4', choices: [{ delta: { content: 'hi' } }] });
  out += t.push({ choices: [], x_groq: { usage: { prompt_tokens: 123, completion_tokens: 4 } } });
  out += t.end();
  const msgDelta = parse(out).find((e) => e.event === 'message_delta')!.data as {
    usage: { input_tokens: number; output_tokens: number };
  };
  assert.deepEqual(msgDelta.usage, { input_tokens: 123, output_tokens: 4 });
});

test('empty upstream (no chunks) still yields a valid message envelope', () => {
  const t = createStreamTranslator('m');
  const events = parse(t.end());
  assert.deepEqual(
    events.map((e) => e.event),
    ['message_start', 'message_delta', 'message_stop'],
  );
});

test('end() is idempotent', () => {
  const t = createStreamTranslator('m');
  t.end();
  assert.equal(t.end(), '');
});

test('SSE parser: split events across feeds, [DONE] swallowed, CRLF tolerated', () => {
  const p = createSseParser();
  const first = p.feed('data: {"id":"c1","choices":[{"delta":{"content":"a"}}]}\r\n\r\ndata: {"cho');
  assert.equal(first.length, 1);
  assert.equal(first[0]!.choices?.[0]?.delta?.content, 'a');
  const second = p.feed('ices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n\n');
  assert.equal(second.length, 1);
  assert.equal(second[0]!.choices?.[0]?.delta?.content, 'b');
});

test('SSE parser flush keeps a final event without a trailing blank line', () => {
  const p = createSseParser();
  const chunks = p.feed(
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":1}}',
  );
  assert.equal(chunks.length, 1);
  const tail = p.flush();
  assert.equal(tail.length, 1);
  assert.deepEqual(tail[0]!.usage, { prompt_tokens: 7, completion_tokens: 1 });
  assert.deepEqual(p.flush(), []);
});
