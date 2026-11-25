// Provider catalog types — shape of providers/<name>.json.

import type { GatewayApi } from './gateway.types.js';

export type ProviderType = 'openrouter' | 'gateway' | 'ollama' | 'anthropic';

/** Where a model runs: downloaded and executed locally, or served by the provider. */
export type ModelLocation = 'local' | 'cloud';

/**
 * What using the model costs — the answer to "will I pay?" for someone who
 * knows nothing about the provider:
 *   free         — never billed, no account (local models)
 *   quota        — free provider account required; free up to a usage quota,
 *                  then blocked until reset or billed/upgraded (every "free"
 *                  cloud tier in practice)
 *   paid         — billed per token from the first request
 *   subscription — unusable until a paid plan is subscribed (e.g. Ollama
 *                  models reserved to Pro/Max)
 */
export type ModelTier = 'free' | 'quota' | 'paid' | 'subscription';

/** A single model entry in a provider catalog. */
export interface ProviderModel {
  id: string;
  name: string;
  /** Billing tier — see ModelTier. */
  tier: ModelTier;
  /** 'local' => runs on the machine (Ollama pull); 'cloud' => served by the provider. */
  location: ModelLocation;
  /** Context window in tokens, when documented. */
  context?: number | null;
  /** Local only: minimum RAM/VRAM to run, in GB. */
  ram_gb?: number | null;
  /** Local only: on-disk download size, in GB (the "ROM" footprint). */
  disk_gb?: number | null;
  /** Cloud paid: price per 1M input tokens, USD. null/absent when free or unlisted. */
  price_in?: number | null;
  /** Cloud paid: price per 1M output tokens, USD. null/absent when free or unlisted. */
  price_out?: number | null;
  /**
   * Set when a free cloud model requires creating an account before use.
   * Value is the provider name shown in the warning (e.g. "groq", "ollama").
   * Absent on local models and models where no account is needed.
   */
  signin_required?: string;
  /** Free-form descriptive note (capabilities, tier caveats). */
  note?: string;
}

/** ANTHROPIC_* environment template applied to the process before launching claude. */
export interface ProviderEnv {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}

/** A provider catalog file. */
export interface Provider {
  /** Catalog key = the JSON file name (e.g. "groq"); set by loadProvider. */
  id?: string;
  type: ProviderType;
  name: string;
  default: string;
  models: ProviderModel[];
  /** Absent for Ollama (no Anthropic endpoint redirection). */
  env?: ProviderEnv;
  /** Required for type 'gateway': upstream OpenAI-compatible endpoint. */
  api?: GatewayApi;
  /**
   * Upstream quota is smaller than Claude Code's full prompt (Groq free tier:
   * 8000 tokens/min vs 24-37k): nexus launches claude with --bare, which drops
   * CLAUDE.md, hooks, MCP and plugins. NEXUS_FULL_PROMPT=1 opts out (paid tier).
   */
  bare?: boolean;
  /** OpenRouter credits endpoint, when available. */
  credits_api?: string;
  /** Human-readable setup hint (account, key page, local install). */
  setup?: string;
}
