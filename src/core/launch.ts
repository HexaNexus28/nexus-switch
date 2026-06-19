import { spawnSync } from 'node:child_process';
import type { Provider } from '../types/provider.types.js';
import { applyProviderEnv } from './env.js';

/** Is the `claude` CLI on PATH? Required for every provider, Ollama included. */
export function claudeExists(): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, ['claude'], { stdio: 'ignore' }).status === 0;
}

/** Launch claude for the selected provider/model, inheriting the terminal. */
export function launch(provider: Provider, model: string, rest: string[]): void {
  if (provider.type === 'ollama') {
    const args = ['launch', 'claude', '--model', model, ...(rest.length ? ['--', ...rest] : [])];
    spawnSync('ollama', args, { stdio: 'inherit' });
    return;
  }
  applyProviderEnv(provider, model);
  spawnSync('claude', rest, { stdio: 'inherit' });
}
