import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Provider, ProviderModel } from '../types/provider.types.js';
import { providersPath } from './providers.js';

/** Write a catalog file without ever leaving a half-written JSON behind. */
function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, path);
  } catch {
    // Windows can refuse a rename over an existing file in rare ACL cases.
    writeFileSync(path, content);
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
}

interface OpenRouterModel {
  id: string;
}

/**
 * Refresh the OpenRouter catalog: drop locally listed models that no longer
 * exist upstream (the source of 404s on launch). Returns the surviving count.
 * Adding new models stays a curation decision, not automated here.
 */
export async function refreshOpenRouter(
  fetchImpl: typeof fetch = fetch,
): Promise<{ kept: number; removed: string[] }> {
  const res = await fetchImpl('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter API responded ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new Error('OpenRouter: liste de modeles vide, catalogue inchange.');
  }
  const upstream = new Set(body.data.map((m) => m.id));

  const file = providersPath('openrouter');
  const provider = JSON.parse(readFileSync(file, 'utf8')) as Provider;
  const removed = provider.models.filter((m) => !upstream.has(m.id)).map((m) => m.id);
  const kept = provider.models.filter((m) => upstream.has(m.id));
  // Never write an empty catalog: loadProvider rejects it and the provider
  // would disappear from the TUI until the user restores the file by hand.
  if (kept.length === 0) {
    throw new Error('OpenRouter: aucun modele local ne survit, catalogue inchange.');
  }
  provider.models = kept;

  writeFileAtomic(file, `${JSON.stringify(provider, null, 2)}\n`);
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

  // No usable model on the machine: never write an empty model_list — that would
  // make loadProvider('ollama') throw "no models" and brick the whole TUI.
  if (ids.length === 0) throw new Error('aucun modele Ollama lancable (catalogue inchange)');

  const file = providersPath('ollama');
  const provider = JSON.parse(readFileSync(file, 'utf8')) as Provider;
  const known = new Map(provider.models.map((m) => [m.id, m]));

  provider.models = ids.map((id): ProviderModel => {
    const existing = known.get(id);
    if (existing) return existing;
    const cloud = id.endsWith(':cloud');
    return {
      id,
      name: id,
      // Discovered cloud models default to the free-quota tier; the curated
      // catalog is where subscription-locked ones get flagged.
      tier: cloud ? 'quota' : 'free',
      location: cloud ? 'cloud' : 'local',
      ...(cloud ? { signin_required: 'ollama' } : { ram_gb: null, disk_gb: null }),
      note: cloud ? 'cloud (quota gratuit, signin requis)' : 'local',
    };
  });

  if (!provider.models.some((m) => m.id === provider.default) && provider.models[0]) {
    provider.default = provider.models[0].id;
  }

  writeFileAtomic(file, `${JSON.stringify(provider, null, 2)}\n`);
  return { models: provider.models.length };
}
