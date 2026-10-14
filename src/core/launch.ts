import { spawn, spawnSync } from 'node:child_process';
import type { Provider } from '../types/provider.types.js';
import { startGateway, type RunningGateway } from '../gateway/server.js';
import { applyProviderEnv, resetProviderEnv } from './env.js';
import { keyVarFor, readKey } from './keys.js';

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

/**
 * Build the ANTHROPIC_* env for a gateway provider: the in-process loopback
 * server URL + the per-session bearer token. The provider's real API key
 * STAYS inside the gateway — it is not exported to the child's env.
 */
function applyGatewayEnv(gateway: RunningGateway, model: string): void {
  process.env.ANTHROPIC_BASE_URL = gateway.baseUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = gateway.token;
  // claude treats an empty API_KEY as "set but blank" in some paths; delete it
  // so the gateway's bearer token is the only credential in play.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_MODEL = model;
  if (!/(?:^|\/)claude-/.test(model)) {
    process.env.MAX_THINKING_TOKENS = '0';
    process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = '1';
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'unset';
  }
}

/**
 * Bring the in-process gateway up for a `gateway`-typed provider. Returns null
 * on any failure (printed as a clean error) — the caller bails out so launch()
 * is never called with a half-wired env.
 */
async function startGatewayForProvider(provider: Provider): Promise<RunningGateway | null> {
  if (!provider.api) {
    console.error(`Provider ${provider.id}: type 'gateway' requires api.base_url + api.model_prefix.`);
    return null;
  }
  const varName = provider.id ? keyVarFor(provider.id) : undefined;
  const apiKey = varName ? readKey(varName) : undefined;
  if (!apiKey) {
    console.error(`Cle API absente pour ${provider.id}. Configure : nexus key set ${provider.id} <cle>`);
    return null;
  }
  try {
    return await startGateway({ api: provider.api, apiKey });
  } catch (err) {
    console.error(`Gateway injoignable (${provider.api.base_url}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function warnOllamaTier(provider: Provider, model: string): void {
  const modelDef = provider.models.find((m) => m.id === model);
  // Fall back to the :cloud suffix for models not in the catalog (e.g. user-pulled
  // custom cloud models discovered by refreshOllama before catalog update).
  if (modelDef?.tier === 'subscription') {
    // Probed 2026-07: these 403 on a free account before any token is served.
    console.error(
      "Modele reserve aux abonnes Ollama Pro/Max — avec un compte gratuit, Claude Code recevra une erreur 403 'requires a subscription'.\n" +
      "Upgrade : ollama.com/upgrade · gratuits avec quota : minimax-m3:cloud, qwen3-coder:480b-cloud, gpt-oss:120b-cloud"
    );
  } else if (modelDef?.signin_required ?? model.endsWith(':cloud')) {
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
}

function runOllama(model: string, rest: string[]): void {
  const args = ['launch', 'claude', '--model', model, ...(rest.length ? ['--', ...rest] : [])];
  const result = spawnSync('ollama', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Echec ollama : ${result.error.message}`);
  } else if (result.status && result.status !== 0) {
    console.error(`ollama a quitte (code ${result.status}). Le modele '${model}' existe-t-il ? -> ollama list`);
  }
}

/**
 * Run claude inheriting the terminal; resolves when it exits.
 *
 * MUST be asynchronous. For `gateway` providers the loopback gateway is an HTTP
 * server inside THIS process, so a synchronous spawn (spawnSync) freezes the
 * event loop for the whole session: the kernel accepts claude's connection but
 * nothing ever answers it, so claude hangs on its first /v1/messages forever
 * while the gateway log shows zero requests. Awaiting a real `spawn` keeps the
 * loop free to serve claude for as long as the session lasts.
 */
function runClaude(rest: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('claude', rest, { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`Echec claude : ${err.message}`);
      process.exitCode = 1;
      resolve();
    });
    // Propagate claude's exit code: `nexus <provider> -p ...` is meant to be
    // scriptable, and a failed turn must not look like a success.
    child.on('exit', (code) => {
      if (code !== null && code !== 0) process.exitCode = code;
      resolve();
    });
  });
}

/**
 * Launch claude for the selected provider/model, inheriting the terminal.
 *
 * Async because gateway providers need to bind a loopback HTTP server before
 * the env is written, and claude must then run WITHOUT blocking this process's
 * event loop (the gateway lives here — see runClaude). Ollama does its work
 * synchronously.
 */
export async function launch(provider: Provider, model: string, rest: string[]): Promise<void> {
  // Single pipeline: always wipe stale provider overrides first (delete, never ""),
  // then branch. A leftover gateway BASE_URL from a previous provider would
  // otherwise hijack the launched claude.
  resetProviderEnv();
  // Any ensure* prompt or the pip install run before this point dirties stdin;
  // claude/ollama inherit the terminal, so stop reading it and reset raw mode
  // first — a lingering parent read steals the child's first keystrokes.
  releaseStdin();
  if (provider.type === 'ollama') {
    warnOllamaTier(provider, model);
    runOllama(model, rest);
    return;
  }
  if (provider.type === 'gateway') {
    const gateway = await startGatewayForProvider(provider);
    if (!gateway) {
      process.exitCode = 1;
      return;
    }
    applyGatewayEnv(gateway, model);
    await runClaude(rest);
    // Close only once claude has exited: the gateway serves every request of the
    // session, and closing it is what lets this process end. Close regardless of
    // claude's exit code — the process is going away either way.
    await gateway.close();
    return;
  }
  applyProviderEnv(provider, model);
  await runClaude(rest);
}
