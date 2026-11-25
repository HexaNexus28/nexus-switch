// OpenAI SSE chunks -> Anthropic SSE events, as a push-based state machine.
//
// Claude Code always streams; this is the hot path. Text is streamed as it
// arrives. Tool calls are BUFFERED per index and emitted as complete tool_use
// blocks at the end: providers may interleave argument deltas for parallel
// calls, and Anthropic content blocks are sequential, so forwarding deltas as
// they arrive can emit input_json_delta for a block that was already closed.
//
// Usage usually arrives in a final chunk with empty choices
// (stream_options.include_usage), so input/output tokens are reported in
// message_delta at the end. Groq puts the same usage under x_groq.usage.

import type { AnthropicStopReason, OpenAIStreamChunk, OpenAIUsage } from '../types/gateway.types.js';
import { mapFinishReason } from './translate.js';

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

export interface ToolProgress {
  id?: string;
  name?: string;
  args: string;
}

export interface StreamTranslator {
  /** Translate one upstream chunk into zero or more Anthropic SSE events. */
  push(chunk: OpenAIStreamChunk): string;
  /** Upstream closed: emit buffered tool blocks, stop reason + usage, message_stop. */
  end(): string;
}

export function createStreamTranslator(requestedModel: string): StreamTranslator {
  let started = false;
  let blockIndex = -1;
  /** 'text' | 'tool' | null — what the currently open block is. */
  let openBlock: 'text' | 'tool' | null = null;
  /** OpenAI tool_call index -> accumulated id/name/arguments. */
  const pendingTools = new Map<number, ToolProgress>();
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
    return sse('content_block_start', {
      index: blockIndex,
      content_block: { type: 'tool_use', id: id ?? `toolu_gw_${index}`, name: name ?? '', input: {} },
    });
  }

  function toolArguments(args: string): string {
    return sse('content_block_delta', {
      index: blockIndex,
      delta: { type: 'input_json_delta', partial_json: args },
    });
  }

  return {
    push(chunk: OpenAIStreamChunk): string {
      let out = '';
      if (!started) out += start(chunk.id);
      if (chunk.usage) usage = chunk.usage;
      else if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return out;

      const text = choice.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        if (openBlock !== 'text') out += closeBlock() + openText();
        out += sse('content_block_delta', { index: blockIndex, delta: { type: 'text_delta', text } });
      }

      const toolCalls = choice.delta?.tool_calls ?? [];
      if (toolCalls.length > 0) {
        // A tool turn follows the text; close the text block now, but keep the
        // tool blocks closed until end() so argument deltas can arrive in any
        // order without violating the sequential-block contract.
        out += closeBlock();
        for (const call of toolCalls) {
          const progress = pendingTools.get(call.index) ?? { args: '' };
          if (call.id) progress.id = call.id;
          if (call.function?.name) progress.name = call.function.name;
          if (call.function?.arguments) progress.args += call.function.arguments;
          pendingTools.set(call.index, progress);
        }
      }

      if (choice.finish_reason) {
        stopReason = mapFinishReason(choice.finish_reason);
        // Some providers report "stop" even when they emitted tool calls.
        if (pendingTools.size > 0 && stopReason === 'end_turn') stopReason = 'tool_use';
      }
      return out;
    },

    end(): string {
      if (ended) return '';
      ended = true;
      let out = '';
      if (!started) out += start(undefined);
      out += closeBlock();
      if (pendingTools.size > 0) {
        if (stopReason === 'end_turn') stopReason = 'tool_use';
        const ordered = [...pendingTools.entries()].sort((a, b) => a[0] - b[0]);
        for (const [index, progress] of ordered) {
          out += openTool(index, progress.id, progress.name);
          if (progress.args) out += toolArguments(progress.args);
          out += closeBlock();
        }
      }
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

/** Parse one SSE event block (lines "data: {...}") into upstream chunks. */
function parseSseEvent(rawEvent: string): OpenAIStreamChunk[] {
  const chunks: OpenAIStreamChunk[] = [];
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
  return chunks;
}

/**
 * Incremental SSE parser for the upstream response. Feed raw bytes, get parsed
 * `data:` JSON payloads back; the OpenAI `[DONE]` sentinel is swallowed.
 *
 * `flush()` must be called when the upstream closes: some providers omit the
 * final blank line, and without it the last event (often the usage chunk) would
 * be silently dropped.
 */
export function createSseParser(): { feed(text: string): OpenAIStreamChunk[]; flush(): OpenAIStreamChunk[] } {
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
        chunks.push(...parseSseEvent(rawEvent));
      }
      return chunks;
    },

    flush(): OpenAIStreamChunk[] {
      const rest = buffer;
      buffer = '';
      return rest.trim() ? parseSseEvent(rest) : [];
    },
  };
}
