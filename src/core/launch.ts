import { spawnSync } from 'node:child_process';
import type { Provider } from '../types/provider.types.js';
import { applyProviderEnv, resetProviderEnv } from './env.js';

/** Is the `claude` CLI on PATH? Required for every provider, Ollama included. */
export function claudeExists(): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, ['claude'], { stdio: 'ignore' }).status === 0;
}

/** Launch claude for the selected provider/model, inheriting the terminal. */
export function launch(provider: Provider, model: string, rest: string[]): void {
  // Single pipeline: always wipe stale provider overrides first (delete, never ""),
  // then branch. A leftover gateway BASE_URL from a previous provider would
  // otherwise hijack the launched claude.
  resetProviderEnv();
  if (provider.type === 'ollama') {
    // Cloud models route through Ollama's hosted backend, which needs a (free) account.
    if (model.endsWith(':cloud')) {
      console.error("Modele Ollama cloud : si ce n'est pas deja fait, connecte-toi avec `ollama signin` (compte gratuit + quota).");
    }
    const args = ['launch', 'claude', '--model', model, ...(rest.length ? ['--', ...rest] : [])];
    const result = spawnSync('ollama', args, { stdio: 'inherit' });
    if (result.error) {
      console.error(`Echec ollama : ${result.error.message}`);
    } else if (result.status && result.status !== 0) {
      console.error(`ollama a quitte (code ${result.status}). Le modele '${model}' existe-t-il ? -> ollama list`);
    }
    return;
  }
  applyProviderEnv(provider, model);
  const result = spawnSync('claude', rest, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Echec claude : ${result.error.message}`);
  }
}
