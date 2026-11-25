// Anthropic <-> OpenAI translation — pure functions, no I/O.
//
// The request side is a WHITELIST: only the fields listed here are translated;
// every other top-level field is dropped and reported. This is the design
// answer to the LiteLLM blacklist failure (additional_drop_params): a new
// Anthropic-only field (output_config yesterday, whatever comes next) can
// never reach a provider and 400 — it is simply never forwarded.

import type {
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicResponseMessage,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIContentPart,
  OpenAIToolCall,
  OpenAIToolChoice,
} from '../types/gateway.types.js';

/** Top-level Anthropic fields the gateway understands; the rest is dropped. */
const REQUEST_WHITELIST = new Set([
  'model',
  'messages',
  'system',
  'max_tokens',
  'temperature',
  'top_p',
  'stop_sequences',
  'stream',
  'tools',
  'tool_choice',
]);

function isTextBlock(block: AnthropicContentBlock): block is AnthropicTextBlock {
  return block.type === 'text';
}

function isImageBlock(block: AnthropicContentBlock): block is AnthropicImageBlock {
  return block.type === 'image';
}

function isToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block.type === 'tool_use';
}

function isToolResultBlock(block: AnthropicContentBlock): block is AnthropicToolResultBlock {
  return block.type === 'tool_result';
}

function systemText(system: string | AnthropicTextBlock[]): string {
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n\n');
}

function imagePart(block: AnthropicImageBlock): OpenAIContentPart {
  const url =
    block.source.type === 'url'
      ? block.source.url
      : `data:${block.source.media_type};base64,${block.source.data}`;
  return { type: 'image_url', image_url: { url } };
}

/** Tool results carry text (and sometimes images, which text-only APIs can't take). */
function toolResultText(block: AnthropicToolResultBlock): string {
  if (block.content === undefined) return '';
  if (typeof block.content === 'string') return block.content;
  return block.content
    .map((b) => (b.type === 'text' ? b.text : '[image omitted]'))
    .join('\n');
}

function userMessages(content: AnthropicContentBlock[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  // tool_result blocks first: OpenAI requires `tool` messages directly after
  // the assistant turn that issued the tool_calls.
  for (const block of content) {
    if (isToolResultBlock(block)) {
      out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: toolResultText(block) });
    }
  }
  const parts: OpenAIContentPart[] = [];
  for (const block of content) {
    if (isTextBlock(block)) parts.push({ type: 'text', text: block.text });
    else if (isImageBlock(block)) parts.push(imagePart(block));
  }
  if (parts.length > 0) {
    const onlyText = parts.every((p) => p.type === 'text');
    out.push({
      role: 'user',
      content: onlyText ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts,
    });
  }
  return out;
}

function assistantMessage(content: AnthropicContentBlock[]): OpenAIChatMessage {
  const text = content.filter(isTextBlock).map((b) => b.text).join('');
  const toolCalls: OpenAIToolCall[] = content.filter(isToolUseBlock).map((b) => ({
    id: b.id,
    type: 'function',
    function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
  }));
  return {
    role: 'assistant',
    content: text ? text : null,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

function translateMessages(
  system: string | AnthropicTextBlock[] | undefined,
  messages: AnthropicMessage[],
): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (system !== undefined) out.push({ role: 'system', content: systemText(system) });
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
    } else if (msg.role === 'user') {
      out.push(...userMessages(msg.content));
    } else {
      out.push(assistantMessage(msg.content));
    }
  }
  return out;
}

/** Client tools only: server tools (versioned type, no schema) can't be forwarded. */
function translateTools(tools: AnthropicTool[]): OpenAIChatRequest['tools'] {
  const usable = tools.filter((t) => typeof t.name === 'string' && t.input_schema !== undefined);
  if (usable.length === 0) return undefined;
  return usable.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      ...(t.description !== undefined && { description: t.description }),
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function translateToolChoice(choice: AnthropicToolChoice): OpenAIToolChoice {
  switch (choice.type) {
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
    case 'none':
      return 'none';
    default:
      return 'auto';
  }
}

export interface TranslatedRequest {
  request: OpenAIChatRequest;
  /** Top-level Anthropic fields that were dropped (for one-shot logging). */
  dropped: string[];
}

export function translateRequest(body: AnthropicMessagesRequest, upstreamModel: string): TranslatedRequest {
  const dropped = Object.keys(body).filter((k) => !REQUEST_WHITELIST.has(k));
  const tools = body.tools ? translateTools(body.tools) : undefined;
  const parallelOff =
    body.tool_choice !== undefined &&
    'disable_parallel_tool_use' in body.tool_choice &&
    body.tool_choice.disable_parallel_tool_use === true;
  const request: OpenAIChatRequest = {
    model: upstreamModel,
    messages: translateMessages(body.system, body.messages),
    max_tokens: body.max_tokens,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...(body.stop_sequences !== undefined && body.stop_sequences.length > 0 && { stop: body.stop_sequences }),
    ...(body.stream === true && { stream: true, stream_options: { include_usage: true } }),
    ...(tools !== undefined && { tools }),
    ...(body.tool_choice !== undefined && tools !== undefined && { tool_choice: translateToolChoice(body.tool_choice) }),
    ...(parallelOff && { parallel_tool_calls: false }),
  };
  return { request, dropped };
}

export function mapFinishReason(reason: string | null | undefined): AnthropicStopReason {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop_sequence') return 'stop_sequence';
  return 'end_turn';
}

/** Providers sometimes emit invalid JSON in arguments; a broken tool call must
 *  not kill the whole response — surface an empty input instead. */
function safeParseArguments(args: string): unknown {
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return {};
  }
}

function toolUseBlocks(toolCalls: OpenAIToolCall[]): AnthropicToolUseBlock[] {
  return toolCalls.map((call, i) => ({
    type: 'tool_use',
    id: call.id || `toolu_gw_${i}`,
    name: call.function.name,
    input: safeParseArguments(call.function.arguments || '{}'),
  }));
}

export function translateResponse(res: OpenAIChatResponse, requestedModel: string): AnthropicResponseMessage {
  const choice = res.choices?.[0];
  const content: AnthropicResponseMessage['content'] = [];
  const text = choice?.message?.content;
  if (typeof text === 'string' && text.length > 0) content.push({ type: 'text', text });
  if (choice?.message?.tool_calls) content.push(...toolUseBlocks(choice.message.tool_calls));
  return {
    id: `msg_gw_${res.id ?? 'unknown'}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

/** Rough token estimate for /v1/messages/count_tokens (~4 chars/token). */
export function estimateTokens(body: unknown): number {
  return Math.ceil(JSON.stringify(body).length / 4);
}
