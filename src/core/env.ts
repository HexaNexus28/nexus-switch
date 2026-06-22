import type { Provider, ProviderType } from '../types/provider.types.js';
import { getSecret } from './secrets.js';

// Snapshot of the env as nexus started, before any resetProviderEnv() wipe.
// User-managed vars like ANTHROPIC_API_KEY (never moved to the store) are
// resolved from here so the universal reset can't erase them before the
// provider template restores them.
const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

const ANTHROPIC_OVERRIDES = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
] as const;

/**
 * Clear provider overrides before launching Ollama or native Anthropic, so a stale
 * gateway base URL from a previous provider doesn't hijack the launched claude.
 */
export function resetProviderEnv(): void {
  for (const key of ANTHROPIC_OVERRIDES) delete process.env[key];
}

/** Resolve ${VAR} placeholders against the secret store, then the original env. */
function resolveTemplate(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, name: string) => getSecret(name) ?? ORIGINAL_ENV[name] ?? '');
}

/**
 * Is the target a claude-* model on an Anthropic-native /v1/messages endpoint?
 * Matches native Anthropic and claude served via a compatible gateway
 * (e.g. OpenRouter's `anthropic/claude-sonnet-4-6`). Anything else (OpenRouter
 * owl-alpha, Groq, Gemini, ...) must have thinking/output_config disabled.
 */
export function isAnthropicNative(type: ProviderType, model: string): boolean {
  return type === 'anthropic' || /(?:^|\/)claude-/.test(model);
}

/** Apply a provider's ANTHROPIC_* template + selected model to process.env before launch. */
export function applyProviderEnv(provider: Provider, model: string): void {
  // Secrets (proxy master key, provider keys) live only in the store now;
  // resolveTemplate pulls ${NEXUS_PROXY_KEY} / ${OPENROUTER_API_KEY} from there,
  // so the resolved ANTHROPIC_AUTH_TOKEN is the only place the value enters the env.
  if (provider.env) {
    for (const [key, template] of Object.entries(provider.env)) {
      const resolved = resolveTemplate(template);
      // Empty => unset. claude treats ANTHROPIC_BASE_URL="" as a set-but-empty
      // override and can misbehave; deleting is the only clean reset.
      if (resolved) process.env[key] = resolved;
      else delete process.env[key];
    }
  }
  process.env.ANTHROPIC_MODEL = model;

  // Non-Anthropic-native models (Groq via LiteLLM, OpenRouter owl-alpha, ...)
  // reject Anthropic-native fields:
  //   thinking_blocks  -> disabled by MAX_THINKING_TOKENS=0
  //   output_config    -> the adaptive-thinking effort field; killed by disabling
  //                       adaptive thinking (reverts to the fixed budget).
  // Keyed on the MODEL, not the transport: OpenRouter also serves non-claude
  // models directly and would 400 exactly like Groq (cf. claude-code #33506).
  if (!isAnthropicNative(provider.type, model)) {
    process.env.MAX_THINKING_TOKENS = '0';
    process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = '1';
  }
}
