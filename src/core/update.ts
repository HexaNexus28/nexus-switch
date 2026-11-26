import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE } from './package-info.js';
import { nexusDataDir } from './secrets.js';

// "A newer nexus exists" notice. Notify, never self-install: `npm i -g` fails on
// Windows while nexus runs (locked files), and a tool holding API keys must not
// swap its own code silently. Same pattern as update-notifier: the registry is
// polled at most once a day in the background, the NEXT run shows the result.

const REGISTRY_LATEST = 'https://registry.npmjs.org/@hexanexus/nexus-switch/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

interface UpdateCache {
  checkedAt: number;
  latest: string;
}

/** Installed version, from the package.json shipped next to dist/. */
export const CURRENT_VERSION: string = PACKAGE.version;

function cachePath(): string {
  return join(nexusDataDir(), 'update-check.json');
}

function disabled(): boolean {
  return process.env.NEXUS_NO_UPDATE_CHECK === '1';
}

function readCache(): UpdateCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as Partial<UpdateCache>;
    if (typeof parsed.checkedAt !== 'number' || typeof parsed.latest !== 'string') return null;
    return { checkedAt: parsed.checkedAt, latest: parsed.latest };
  } catch {
    return null;
  }
}

/** Is `candidate` a strictly higher x.y.z than `current`? Pre-release tags are ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Newer published version known from the last check, else null. No network. */
export function availableUpdate(): string | null {
  if (disabled() || !CURRENT_VERSION) return null;
  const cache = readCache();
  return cache && isNewer(cache.latest, CURRENT_VERSION) ? cache.latest : null;
}

/** Poll npm when the last check is older than a day. Never throws, never blocks long. */
export async function refreshUpdateCache(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (disabled()) return;
  const cache = readCache();
  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) return;
  try {
    const res = await fetchImpl(REGISTRY_LATEST, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== 'string') return;
    writeFileSync(cachePath(), JSON.stringify({ checkedAt: Date.now(), latest: body.version }));
  } catch {
    /* offline, registry down, read-only data dir: try again next run */
  }
}
