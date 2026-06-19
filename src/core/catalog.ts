import { readFileSync, writeFileSync } from 'node:fs';
import type { Provider } from '../types/provider.types.js';
import { providersPath } from './providers.js';

interface OpenRouterModel {
  id: string;
}

/**
 * Refresh the OpenRouter catalog: drop locally listed models that no longer
 * exist upstream (the source of 404s on launch). Returns the surviving count.
 * Adding new models stays a curation decision, not automated here.
 */
export async function refreshOpenRouter(): Promise<{ kept: number; removed: string[] }> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter API responded ${res.status}`);
  const body = (await res.json()) as { data: OpenRouterModel[] };
  const upstream = new Set(body.data.map((m) => m.id));

  const file = providersPath('openrouter');
  const provider = JSON.parse(readFileSync(file, 'utf8')) as Provider;
  const removed = provider.models.filter((m) => !upstream.has(m.id)).map((m) => m.id);
  provider.models = provider.models.filter((m) => upstream.has(m.id));

  writeFileSync(file, `${JSON.stringify(provider, null, 2)}\n`);
  return { kept: provider.models.length, removed };
}
