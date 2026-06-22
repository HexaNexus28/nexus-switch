// Provider catalog types — shape of providers/<name>.json.

export type ProviderType = 'openrouter' | 'litellm' | 'ollama' | 'anthropic';

/** A single model entry in a provider catalog. */
export interface ProviderModel {
  id: string;
  name: string;
  free: boolean;
  note?: string;
  /** RAM hint for local Ollama models; null/absent for cloud or non-local providers. */
  ram_gb?: number | null;
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
  /** OpenRouter credits endpoint, when available. */
  credits_api?: string;
  /** Human-readable setup hint (e.g. LiteLLM proxy install). */
  setup?: string;
}
