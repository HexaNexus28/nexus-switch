import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Provider, ProviderType } from '../types/provider.types.js';

const VALID_TYPES: readonly ProviderType[] = ['openrouter', 'litellm', 'ollama', 'anthropic'];

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
  return data as Provider;
}

export function loadProvider(name: string): Provider {
  const provider = validate(name, JSON.parse(readFileSync(providersPath(name), 'utf8')));
  provider.id = name; // catalog key, used to resolve the provider's API key var
  return provider;
}

export function listProviders(): string[] {
  return readdirSync(providersDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

export function loadAllProviders(): Provider[] {
  return listProviders().map(loadProvider);
}
