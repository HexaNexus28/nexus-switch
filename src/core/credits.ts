import { KEY_VARS, readKey } from './keys.js';
import { loadProvider } from './providers.js';
import { t } from '../i18n/index.js';

interface OpenRouterCredits {
  data?: { total_credits?: number; total_usage?: number };
}

/** Human-readable OpenRouter balance, or a reason string when unavailable. */
export async function openRouterCredits(): Promise<string> {
  const key = readKey('OPENROUTER_API_KEY');
  if (!key) return t.credits.keyMissing;
  let api: string | undefined;
  try {
    api = loadProvider('openrouter').credits_api;
  } catch {
    return t.credits.providerNotFound;
  }
  if (!api) return t.credits.noCreditsApi;
  try {
    const res = await fetch(api, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return `API ${res.status}`;
    const body = (await res.json()) as OpenRouterCredits;
    const total = body.data?.total_credits ?? 0;
    const used = body.data?.total_usage ?? 0;
    return t.credits.remaining((total - used).toFixed(2), used.toFixed(2), total.toFixed(2));
  } catch {
    return t.credits.unreachable;
  }
}

/** Key-presence summary for the gateway-typed providers. */
export function gatewayKeyStatus(): { provider: string; present: boolean }[] {
  return (['groq', 'gemini', 'cerebras', 'mistral', 'nvidia'] as const).map((provider) => ({
    provider,
    present: Boolean(readKey(KEY_VARS[provider] ?? '')),
  }));
}
