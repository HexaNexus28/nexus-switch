import { KEY_VARS, readKey } from './keys.js';
import { loadProvider } from './providers.js';

interface OpenRouterCredits {
  data?: { total_credits?: number; total_usage?: number };
}

/** Human-readable OpenRouter balance, or a reason string when unavailable. */
export async function openRouterCredits(): Promise<string> {
  const key = readKey('OPENROUTER_API_KEY');
  if (!key) return 'cle absente';
  let api: string | undefined;
  try {
    api = loadProvider('openrouter').credits_api;
  } catch {
    return 'provider introuvable';
  }
  if (!api) return 'pas de credits_api';
  try {
    const res = await fetch(api, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return `API ${res.status}`;
    const body = (await res.json()) as OpenRouterCredits;
    const total = body.data?.total_credits ?? 0;
    const used = body.data?.total_usage ?? 0;
    return `${(total - used).toFixed(2)} restants (utilise ${used.toFixed(2)} / ${total.toFixed(2)})`;
  } catch {
    return 'injoignable';
  }
}

/** Key-presence summary for the LiteLLM-backed providers. */
export function litellmKeyStatus(): { provider: string; present: boolean }[] {
  return (['groq', 'gemini', 'cerebras', 'mistral', 'nvidia'] as const).map((provider) => ({
    provider,
    present: Boolean(readKey(KEY_VARS[provider] ?? '')),
  }));
}
