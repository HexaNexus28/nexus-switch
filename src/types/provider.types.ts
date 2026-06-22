// Provider catalog types — shape of providers/<name>.json.

export type ProviderType = 'openrouter' | 'litellm' | 'ollama' | 'anthropic';

/** Where a model runs: downloaded and executed locally, or served by the provider. */
export type ModelLocation = 'local' | 'cloud';

/** A single model entry in a provider catalog. */
export interface ProviderModel {
  id: string;
  name: string;
  /** True when usable at no cost (local model, or a free cloud tier/endpoint). */
  free: boolean;
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
  /** OpenRouter credits endpoint, when available. */
  credits_api?: string;
  /** Human-readable setup hint (e.g. LiteLLM proxy install). */
  setup?: string;
}
