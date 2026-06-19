import type { Provider } from '../types/provider.types.js';
import { readPersistedKey } from '../platform/persist.js';

/** Resolve ${VAR} placeholders against the current environment. */
function resolveTemplate(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, name: string) => process.env[name] ?? '');
}

/** Apply a provider's ANTHROPIC_* template + selected model to process.env before launch. */
export function applyProviderEnv(provider: Provider, model: string): void {
  // The proxy master key may have been set by another session; hydrate it so the
  // ${NEXUS_PROXY_KEY} auth token matches the running proxy (else LiteLLM 'No connected db').
  if (provider.type === 'litellm' && !process.env.NEXUS_PROXY_KEY) {
    const persisted = readPersistedKey('NEXUS_PROXY_KEY');
    if (persisted) process.env.NEXUS_PROXY_KEY = persisted;
  }
  if (provider.env) {
    for (const [key, template] of Object.entries(provider.env)) {
      process.env[key] = resolveTemplate(template);
    }
  }
  process.env.ANTHROPIC_MODEL = model;

  // Non-Anthropic models behind LiteLLM (Groq, etc.) reject Anthropic thinking_blocks
  // (400 'thinking_blocks' is unsupported). Disable extended thinking client-side so
  // Claude Code never produces them.
  if (provider.type === 'litellm') {
    process.env.MAX_THINKING_TOKENS = '0';
  }
}
