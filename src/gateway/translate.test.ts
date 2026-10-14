import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnthropicMessagesRequest, OpenAIChatResponse } from '../types/gateway.types.js';
import { estimateTokens, mapFinishReason, translateRequest, translateResponse } from './translate.js';

const base = (over: Partial<AnthropicMessagesRequest>): AnthropicMessagesRequest => ({
  model: 'groq/qwen/qwen3.6-27b',
  max_tokens: 128,
  messages: [{ role: 'user', content: 'hello' }],
  ...over,
});

test('whitelist: unknown top-level fields are dropped and reported, never forwarded', () => {
  const { request, dropped } = translateRequest(
    base({
      output_config: { effort: 'high' },
      thinking: { type: 'disabled' },
      metadata: { user_id: 'x' },
      context_management: {},
    }),
    'qwen/qwen3.6-27b',
  );
  assert.deepEqual(dropped.sort(), ['context_management', 'metadata', 'output_config', 'thinking']);
  const forwarded = Object.keys(request);
  for (const field of dropped) assert.ok(!forwarded.includes(field), `${field} leaked`);
  assert.equal(request.model, 'qwen/qwen3.6-27b');
});

test('system blocks are joined into one system message, cache_control stripped', () => {
  const { request } = translateRequest(
    base({
      system: [
        { type: 'text', text: 'You are a CLI.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Be terse.' },
      ],
    }),
    'm',
  );
  assert.deepEqual(request.messages[0], { role: 'system', content: 'You are a CLI.\n\nBe terse.' });
});

test('user tool_result blocks become tool messages BEFORE the user text', () => {
  const { request } = translateRequest(
    base({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_1', name: 'ls', input: { path: '.' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'continue' },
            { type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'file.ts' }] },
          ],
        },
      ],
    }),
    'm',
  );
  const [assistant, tool, user] = request.messages;
  assert.deepEqual(assistant, {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{"path":"."}' } }],
  });
  assert.deepEqual(tool, { role: 'tool', tool_call_id: 'call_1', content: 'file.ts' });
  assert.deepEqual(user, { role: 'user', content: 'continue' });
});

test('thinking blocks are dropped from assistant turns', () => {
  const { request } = translateRequest(
    base({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking' },
            { type: 'text', text: 'answer' },
          ],
        },
      ],
    }),
    'm',
  );
  assert.deepEqual(request.messages.at(-1), { role: 'assistant', content: 'answer' });
});

test('images become data-URI image_url parts; mixed content stays multipart', () => {
  const { request } = translateRequest(
    base({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ],
    }),
    'm',
  );
  assert.deepEqual(request.messages.at(-1), {
    role: 'user',
    content: [
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ],
  });
});

test('client tools are translated; server tools (no input_schema) are skipped', () => {
  const { request } = translateRequest(
    base({
      tools: [
        { name: 'Bash', description: 'run', input_schema: { type: 'object' } },
        { name: 'web_search', type: 'web_search_20250305' },
      ],
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    }),
    'm',
  );
  assert.deepEqual(request.tools, [
    { type: 'function', function: { name: 'Bash', description: 'run', parameters: { type: 'object' } } },
  ]);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.parallel_tool_calls, false);
});

test('tool_choice {type:tool} pins the function; stream adds include_usage', () => {
  const { request } = translateRequest(
    base({
      stream: true,
      tools: [{ name: 'Read', input_schema: {} }],
      tool_choice: { type: 'tool', name: 'Read' },
    }),
    'm',
  );
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'Read' } });
  assert.equal(request.stream, true);
  assert.deepEqual(request.stream_options, { include_usage: true });
});

test('response: text + tool_calls -> Anthropic blocks, bad JSON arguments degrade to {}', () => {
  const res: OpenAIChatResponse = {
    id: 'chatcmpl-1',
    choices: [
      {
        message: {
          content: 'done',
          tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'ls', arguments: '{"path":"."}' } },
            { id: 'call_b', type: 'function', function: { name: 'rm', arguments: '{broken' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 30000, completion_tokens: 12 },
  };
  const msg = translateResponse(res, 'groq/qwen/qwen3.6-27b');
  assert.equal(msg.model, 'groq/qwen/qwen3.6-27b');
  assert.deepEqual(msg.content, [
    { type: 'text', text: 'done' },
    { type: 'tool_use', id: 'call_a', name: 'ls', input: { path: '.' } },
    { type: 'tool_use', id: 'call_b', name: 'rm', input: {} },
  ]);
  assert.equal(msg.stop_reason, 'tool_use');
  assert.deepEqual(msg.usage, { input_tokens: 30000, output_tokens: 12 });
});

test('finish reason mapping', () => {
  assert.equal(mapFinishReason('stop'), 'end_turn');
  assert.equal(mapFinishReason('length'), 'max_tokens');
  assert.equal(mapFinishReason('tool_calls'), 'tool_use');
  assert.equal(mapFinishReason(null), 'end_turn');
});

test('estimateTokens is ~chars/4', () => {
  assert.equal(estimateTokens({ a: 'bbbb' }), Math.ceil('{"a":"bbbb"}'.length / 4));
});
