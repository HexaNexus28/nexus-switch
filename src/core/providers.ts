import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelClass, Provider, ProviderType } from '../types/provider.types.js';
import { t } from '../i18n/index.js';

const VALID_TYPES: readonly ProviderType[] = ['openrouter', 'gateway', 'ollama', 'anthropic'];
const VALID_CLASSES: readonly ModelClass[] = ['large', 'fast'];

// Resolves to dist/core at runtime; providers/ sits two levels up at the package root.
const moduleDir = dirname(fileURLToPath(import.meta.url));

function providersDir(): string {
  const home = process.env.NEXUS_SWITCH_HOME;
  return home ? join(home, 'providers') : join(moduleDir, '..', '..', 'providers');
}

export function providersPath(name: string): string {
  return join(providersDir(), `${name}.json`);
}

function validate(name: string, data: unknown): Provider {
  if (typeof data !== 'object' || data === null) throw new Error(`${name}: not an object`);
  const p = data as Record<string, unknown>;
  if (typeof p.type !== 'string' || !VALID_TYPES.includes(p.type as ProviderType)) {
    throw new Error(`${name}: invalid type "${String(p.type)}"`);
  }
  if (typeof p.name !== 'string') throw new Error(`${name}: missing name`);
  if (typeof p.default !== 'string') throw new Error(`${name}: missing default`);
  if (!Array.isArray(p.models) || p.models.length === 0) throw new Error(`${name}: no models`);
  if (p.type === 'gateway') {
    const api = p.api as { base_url?: unknown; model_prefix?: unknown } | undefined;
    if (typeof api?.base_url !== 'string' || typeof api?.model_prefix !== 'string') {
      throw new Error(`${name}: gateway provider needs api.base_url and api.model_prefix`);
    }
  }
  if (p.bare !== undefined && typeof p.bare !== 'boolean') throw new Error(`${name}: bare must be a boolean`);
  for (const field of ['max_request_tokens', 'fallback_order'] as const) {
    if (p[field] !== undefined && (typeof p[field] !== 'number' || !Number.isFinite(p[field]))) {
      throw new Error(`${name}: ${field} must be a number`);
    }
  }
  if (p.data_policy !== undefined) {
    const d = p.data_policy as { summary?: unknown; source?: unknown; checked?: unknown };
    if (typeof d.summary !== 'string' || typeof d.source !== 'string' || typeof d.checked !== 'string') {
      throw new Error(`${name}: data_policy needs summary, source and checked`);
    }
  }
  for (const m of p.models as Array<{ id?: unknown; class?: unknown }>) {
    if (m.class !== undefined && !VALID_CLASSES.includes(m.class as ModelClass)) {
      throw new Error(`${name}: model ${String(m.id)} has invalid class "${String(m.class)}"`);
    }
  }
  return data as Provider;
}

export function loadProvider(name: string): Provider {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(providersPath(name), 'utf8'));
  } catch (err) {
    // JSON.parse SyntaxErrors don't name the file — rethrow with the catalog
    // key so a warning (or a direct-launch failure) is always actionable.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${name}: invalid JSON (${reason})`);
  }
  const provider = validate(name, data);
  provider.id = name; // catalog key, used to resolve the provider's API key var
  return provider;
}

export function listProviders(): string[] {
  return readdirSync(providersDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

/**
 * Load every catalog file, SKIPPING the invalid ones with a console warning.
 *
 * One bad providers/*.json used to kill the whole interactive hub (the load
 * threw straight out of runTui). A catalog file is user-upgradeable state, not
 * program logic: a stale file from an older version (e.g. a provider still
 * typed "litellm") must never lock the user out of the seven healthy ones.
 * Direct launches (`nexus <name>`) still go through loadProvider and fail hard
 * with the exact validation error — asking for one specific provider should
 * surface its specific problem.
 */
export function loadAllProviders(): Provider[] {
  const loaded: Provider[] = [];
  for (const name of listProviders()) {
    try {
      loaded.push(loadProvider(name));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(t.catalog.invalidProvider(reason));
    }
  }
  return loaded;
}
