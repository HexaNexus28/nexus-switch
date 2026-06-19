import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Provider, ProviderModel } from '../types/provider.types.js';
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

/**
 * Rebuild the Ollama catalog from the machine's `ollama list` (the ground truth for
 * what can actually launch). Keeps known metadata, infers free=local for new ids,
 * skips embedding models. Returns the surviving count.
 */
export function refreshOllama(): { models: number } {
  const result = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('`ollama list` a echoue (ollama installe ?)');

  const ids = result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((id): id is string => id != null && id.length > 0 && !/embed/i.test(id));

  const file = providersPath('ollama');
  const provider = JSON.parse(readFileSync(file, 'utf8')) as Provider;
  const known = new Map(provider.models.map((m) => [m.id, m]));

  provider.models = ids.map((id): ProviderModel => {
    const existing = known.get(id);
    if (existing) return existing;
    const cloud = id.endsWith(':cloud');
    return { id, name: id, free: !cloud, ram_gb: null, note: cloud ? 'cloud' : 'local' };
  });

  if (!provider.models.some((m) => m.id === provider.default) && provider.models[0]) {
    provider.default = provider.models[0].id;
  }

  writeFileSync(file, `${JSON.stringify(provider, null, 2)}\n`);
  return { models: provider.models.length };
}
