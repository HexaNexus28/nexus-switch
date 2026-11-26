// User preferences in ~/.nexus-switch/config.json (never secrets: those live in
// secrets.json). Today: whether fallback is on, and in which order.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nexusDataDir } from './secrets.js';

/** Absent = fallback off: nexus never sends code to a provider the user did not pick. */
export type FallbackSetting = { mode: 'auto' } | { mode: 'manual'; providers: string[] };

export interface NexusConfig {
  /** Set only after the user saw each provider's data policy and confirmed (`nexus chain`). */
  fallback?: FallbackSetting;
}

function configPath(): string {
  return join(nexusDataDir(), 'config.json');
}

export function readConfig(): NexusConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as NexusConfig) : {};
  } catch {
    return {}; // a hand-broken preferences file must not block a launch
  }
}

export function writeConfig(config: NexusConfig): void {
  mkdirSync(nexusDataDir(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}
