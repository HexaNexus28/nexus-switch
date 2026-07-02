import { spawnSync } from 'node:child_process';
import type { Provider } from '../types/provider.types.js';
import { applyProviderEnv, resetProviderEnv } from './env.js';

/** Is the `claude` CLI on PATH? Required for every provider, Ollama included. */
export function claudeExists(): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, ['claude'], { stdio: 'ignore' }).status === 0;
}

/**
 * Reset stdin to a clean cooked state and STOP reading it. Ink (raw mode) and
 * the readline prompts leave stdin dirtied; more importantly, a parent stdin
 * left in flowing mode keeps a console read pending on Windows (libuv reads the
 * console from a thread, so spawnSync blocking the loop does not stop it). That
 * pending read competes with the inherited child for keystrokes: claude ignores
 * typing until a mouse click flushes the stale read. Nobody needs stdin flowing
 * here — readline resumes the stream itself when a prompt attaches (the direct
 * CLI path proves it: stdin starts paused and prompts work), and the child
 * inherits the TTY handle directly, unaffected by the parent's pause.
 */
export function releaseStdin(): void {
  const { stdin } = process;
  // Only act on a real interactive terminal — a piped stdin (tests, CI) has no
  // raw mode and no console read to cancel.
  if (!stdin.isTTY) return;
  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
  stdin.pause();
}

/**
 * Run `npm <args>` inheriting the terminal. On Windows `npm` is a `.cmd` shim
 * that Node 20+ refuses to spawn directly (EINVAL / ENOENT), so the global
 * install/update/uninstall silently failed after the user accepted the prompt.
 * Routing through cmd.exe (a real executable) makes it actually run.
 */
export function runNpm(args: string[]): void {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'npm', ...args], { stdio: 'inherit' });
  } else {
    spawnSync('npm', args, { stdio: 'inherit' });
  }
}

/** Launch claude for the selected provider/model, inheriting the terminal. */
export function launch(provider: Provider, model: string, rest: string[]): void {
  // Single pipeline: always wipe stale provider overrides first (delete, never ""),
  // then branch. A leftover gateway BASE_URL from a previous provider would
  // otherwise hijack the launched claude.
  resetProviderEnv();
  // Any ensure* prompt or the pip install run before this point dirties stdin;
  // claude/ollama inherit the terminal, so stop reading it and reset raw mode
  // first — a lingering parent read steals the child's first keystrokes.
  releaseStdin();
  if (provider.type === 'ollama') {
    const modelDef = provider.models.find((m) => m.id === model);
    // Fall back to the :cloud suffix for models not in the catalog (e.g. user-pulled
    // custom cloud models discovered by refreshOllama before catalog update).
    if (modelDef?.signin_required ?? model.endsWith(':cloud')) {
      // Cloud models route through Ollama's hosted backend — needs a free account + CLI signin.
      console.error(
        "Modele Ollama cloud — compte requis (gratuit, sans CB) : ollama.com\n" +
        "Lance `ollama signin` si ce n'est pas encore fait.\n" +
        "Quota gratuit : reset toutes les 5h + hebdomadaire, 1 modele concurrent.\n" +
        "Pour lever les limites : Pro 20$/mois · Max 100$/mois -> ollama.com/pricing"
      );
    } else {
      // Local models load fully into RAM/VRAM; large context KV cache can be many GB -> OOM.
      console.error("Modele Ollama local : grand contexte = beaucoup de RAM/VRAM. Si 'out of memory' -> bascule sur un modele :cloud, ou baisse OLLAMA_CONTEXT_LENGTH (ex. 16384) et relance Ollama.");
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
