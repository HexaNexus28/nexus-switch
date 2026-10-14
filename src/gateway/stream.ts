// OpenAI SSE chunks -> Anthropic SSE events, as a push-based state machine.
//
// Claude Code always streams; this is the hot path. The translator tracks one
// open content block at a time (Anthropic blocks are sequential) and maps the
// index-based OpenAI tool_call deltas onto tool_use blocks. Usage usually
// arrives in a final chunk with empty choices (stream_options.include_usage),
// so input/output tokens are reported in message_delta at the end.

import type { AnthropicStopReason, OpenAIStreamChunk, OpenAIUsage } from '../types/gateway.types.js';
import { mapFinishReason } from './translate.js';

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

export interface StreamTranslator {
  /** Translate one upstream chunk into zero or more Anthropic SSE events. */
  push(chunk: OpenAIStreamChunk): string;
  /** Upstream closed: emit message_delta (stop reason + usage) and message_stop. */
  end(): string;
}

export function createStreamTranslator(requestedModel: string): StreamTranslator {
  let started = false;
  let blockIndex = -1;
  /** 'text' | 'tool' | null — what the currently open block is. */
  let openBlock: 'text' | 'tool' | null = null;
  /** OpenAI tool_call index -> Anthropic block index, to route argument deltas. */
  const toolBlocks = new Map<number, number>();
  let currentToolIndex = -1;
  let stopReason: AnthropicStopReason = 'end_turn';
  let usage: OpenAIUsage = {};
  let ended = false;

  function start(id: string | undefined): string {
    started = true;
    return sse('message_start', {
      message: {
        id: `msg_gw_${id ?? 'stream'}`,
        type: 'message',
        role: 'assistant',
        model: requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function closeBlock(): string {
    if (openBlock === null) return '';
    openBlock = null;
    return sse('content_block_stop', { index: blockIndex });
  }

  function openText(): string {
    blockIndex += 1;
    openBlock = 'text';
    return sse('content_block_start', { index: blockIndex, content_block: { type: 'text', text: '' } });
  }

  function openTool(index: number, id: string | undefined, name: string | undefined): string {
    blockIndex += 1;
    openBlock = 'tool';
    currentToolIndex = index;
    toolBlocks.set(index, blockIndex);
    return sse('content_block_start', {
      index: blockIndex,
      content_block: { type: 'tool_use', id: id ?? `toolu_gw_${index}`, name: name ?? '', input: {} },
    });
  }

  return {
    push(chunk: OpenAIStreamChunk): string {
      let out = '';
      if (!started) out += start(chunk.id);
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return out;
      const text = choice.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        if (openBlock !== 'text') out += closeBlock() + openText();
        out += sse('content_block_delta', { index: blockIndex, delta: { type: 'text_delta', text } });
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        if (!toolBlocks.has(call.index)) {
          out += closeBlock() + openTool(call.index, call.id, call.function?.name);
        } else if (openBlock !== 'tool' || currentToolIndex !== call.index) {
          // Argument deltas for an already-open tool arriving out of order —
          // providers stream tools sequentially, so route to its block index.
          currentToolIndex = call.index;
        }
        const args = call.function?.arguments;
        if (typeof args === 'string' && args.length > 0) {
          out += sse('content_block_delta', {
            index: toolBlocks.get(call.index),
            delta: { type: 'input_json_delta', partial_json: args },
          });
        }
      }
      if (choice.finish_reason) stopReason = mapFinishReason(choice.finish_reason);
      return out;
    },

    end(): string {
      if (ended) return '';
      ended = true;
      let out = '';
      if (!started) out += start(undefined);
      out += closeBlock();
      out += sse('message_delta', {
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: {
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
        },
      });
      out += sse('message_stop', {});
      return out;
    },
  };
}

/**
 * Incremental SSE parser for the upstream response. Feed raw bytes, get parsed
 * `data:` JSON payloads back; the OpenAI `[DONE]` sentinel is swallowed.
 */
export function createSseParser(): { feed(text: string): OpenAIStreamChunk[] } {
  let buffer = '';
  return {
    feed(text: string): OpenAIStreamChunk[] {
      buffer += text;
      const chunks: OpenAIStreamChunk[] = [];
      let sep: number;
      // Events are separated by a blank line; keep the trailing partial event.
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        for (const line of rawEvent.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '' || payload === '[DONE]') continue;
          try {
            chunks.push(JSON.parse(payload) as OpenAIStreamChunk);
          } catch {
            // Truncated or non-JSON data line: skip rather than kill the stream.
          }
        }
      }
      return chunks;
    },
  };
}
