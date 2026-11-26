import type { Provider, ProviderType } from '../types/provider.types.js';
import { getSecret } from './secrets.js';

// Snapshot of the env as nexus started, before any resetProviderEnv() wipe.
// User-managed vars like ANTHROPIC_API_KEY (never moved to the store) are
// resolved from here so the universal reset can't erase them before the
// provider template restores them.
const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

/**
 * Claude Code resolves its "haiku" model (used for background work: titles,
 * summaries) and the /model aliases from these variables. A third-party
 * provider serves none of the Anthropic ids, so every alias must point at the
 * selected model — otherwise claude sends e.g. claude-haiku-5-5 to Groq and
 * every background request 404s.
 */
export const MODEL_ALIAS_VARS = [
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
] as const;

const ANTHROPIC_OVERRIDES = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  ...MODEL_ALIAS_VARS,
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_AUTO_MODE_SERVER',
] as const;

/**
 * Clear provider overrides before launching Ollama or native Anthropic, so a stale
 * gateway base URL from a previous provider doesn't hijack the launched claude.
 */
export function resetProviderEnv(): void {
  for (const key of ANTHROPIC_OVERRIDES) delete process.env[key];
}

/** Point every Claude Code model alias at the model Nexus is launching. */
export function applyModelAliases(model: string): void {
  for (const key of MODEL_ALIAS_VARS) process.env[key] = model;
}

/**
 * Claude Code assumes a 1M window for any model id it doesn't know, so it never
 * auto-compacts before the provider's real limit and the session dies on a
 * context-length error. The catalog knows the real window; hand it over.
 */
export function applyContextWindow(provider: Provider, model: string): void {
  const context = provider.models.find((m) => m.id === model)?.context;
  if (context && context > 0) process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(context);
  else delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
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

  // Native Anthropic keeps the user's own alias mapping; every other provider
  // must map background/alias requests onto the model it actually serves.
  if (provider.type === 'anthropic') {
    // resetProviderEnv() wipes the overrides; restore aliases the user had set
    // globally before nexus started rather than silently discarding them.
    for (const key of MODEL_ALIAS_VARS) {
      const original = ORIGINAL_ENV[key];
      if (original) process.env[key] = original;
      else delete process.env[key];
    }
  } else {
    applyModelAliases(model);
    applyContextWindow(provider, model);
  }

  // Non-Anthropic-native models (Groq via the gateway, OpenRouter owl-alpha, ...)
  // reject Anthropic-native fields:
  //   thinking_blocks  -> disabled by MAX_THINKING_TOKENS=0
  //   output_config    -> effort is emitted whenever claude believes the model
  //                       supports it (unknown model + first-party transport =>
  //                       yes) and a settings effortLevel is set. EFFORT_LEVEL
  //                       "unset" overrides settings and suppresses the field.
  //                       LiteLLM's additional_drop_params can't catch it: the
  //                       /v1/messages bridge forwards unknown body fields.
  // DISABLE_ADAPTIVE_THINKING is dead weight on claude >= 2.1.x (only honored
  // for *-4-6 models) but kept for older installs where it was the mechanism.
  // Keyed on the MODEL, not the transport: OpenRouter also serves non-claude
  // models directly and would 400 exactly like Groq (cf. claude-code #33506).
  if (!isAnthropicNative(provider.type, model)) {
    process.env.MAX_THINKING_TOKENS = '0';
    process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = '1';
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'unset';
  }
}
