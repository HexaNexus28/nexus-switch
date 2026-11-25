// Wire types for the native gateway — the exact subset of the Anthropic and
// OpenAI chat schemas the translation layer understands. Anything outside
// these shapes is dropped by design (whitelist), never forwarded.

// --- Anthropic /v1/messages (what Claude Code emits) -------------------------

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  /** Prompt-caching hint; first-party only, stripped in translation. */
  cache_control?: unknown;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
}

/** Unknown block types (thinking, redacted_thinking, future ones) are dropped. */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  /** Server tools carry a versioned type and no input_schema; those are dropped. */
  type?: string;
}

export type AnthropicToolChoice =
  | { type: 'auto'; disable_parallel_tool_use?: boolean }
  | { type: 'any'; disable_parallel_tool_use?: boolean }
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'none' };

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  /** Everything else Claude Code sends (thinking, output_config, metadata,
   *  context_management, mcp_servers, container, betas, ...) is dropped. */
  [key: string]: unknown;
}

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicResponseMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: AnthropicStopReason | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicError {
  type: 'error';
  error: { type: string; message: string };
}

// --- OpenAI chat/completions (what the providers accept) ---------------------

export interface OpenAIContentPartText {
  type: 'text';
  text: string;
}

export interface OpenAIContentPartImage {
  type: 'image_url';
  image_url: { url: string };
}

export type OpenAIContentPart = OpenAIContentPartText | OpenAIContentPartImage;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export type OpenAIToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  parallel_tool_calls?: boolean;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage;
}

/** Streaming delta chunk. tool_calls deltas are index-based and partial. */
export interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage | null;
  /** Groq reports the final usage here instead of the top-level `usage`. */
  x_groq?: { usage?: OpenAIUsage | null } | null;
}

// --- Gateway ------------------------------------------------------------------

/** Per-provider upstream description, from providers/<name>.json `api`. */
export interface GatewayApi {
  /** OpenAI-compatible base, e.g. https://api.groq.com/openai/v1 */
  base_url: string;
  /** Catalog prefix stripped from model ids before forwarding, e.g. "groq/". */
  model_prefix: string;
}
