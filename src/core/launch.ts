import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Provider } from '../types/provider.types.js';
import { startGateway, type RunningGateway } from '../gateway/server.js';
import { applyContextWindow, applyModelAliases, applyProviderEnv, resetProviderEnv } from './env.js';
import { keyVarFor, readKey } from './keys.js';
import { t } from '../i18n/index.js';

/** A resolved way to start claude that works on POSIX and through npm's .cmd shims. */
export type ClaudeCommand =
  | { kind: 'direct'; file: string; args: string[] }
  | { kind: 'cmd-shim'; comspec: string; shim: string };

/** Quote one argument for a cmd.exe /c command line (Windows .cmd fallback). */
function quoteCmdArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Standard npm layouts for the JS entrypoint behind a claude.cmd shim. */
function shimJsEntry(shim: string): string | null {
  const dir = dirname(shim);
  const candidates = [
    join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), // global npm prefix
    join(dir, '..', '@anthropic-ai', 'claude-code', 'cli.js'), // local node_modules/.bin
    join(dir, '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    join(dir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the claude executable ONCE, for both detection and launch.
 *
 * `where claude` finds npm's `claude.cmd`, but Node's spawn without a shell only
 * resolves `.exe` (CreateProcess appends .exe); spawning the shim path directly
 * therefore fails with ENOENT on every npm install. Prefer a native .exe, then
 * run the shim's JS entrypoint with node (no cmd.exe quoting at all), and only
 * fall back to cmd.exe for unusual shim layouts.
 */
export function resolveClaude(): ClaudeCommand | null {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, ['claude'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const hits = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (hits.length === 0) return null;

  const exe = hits.find((p) => p.toLowerCase().endsWith('.exe'));
  if (exe) return { kind: 'direct', file: exe, args: [] };

  const shim = hits.find((p) => /\.(cmd|bat)$/i.test(p));
  if (shim) {
    const js = shimJsEntry(shim);
    if (js) return { kind: 'direct', file: process.execPath, args: [js] };
    return { kind: 'cmd-shim', comspec: process.env.ComSpec ?? 'cmd.exe', shim };
  }

  return { kind: 'direct', file: hits[0]!, args: [] };
}

/** Is the `claude` CLI on PATH? Required for every provider, Ollama included. */
export function claudeExists(): boolean {
  return resolveClaude() !== null;
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
export function runNpm(args: string[]): number | null {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'npm', ...args], { stdio: 'inherit' })
      : spawnSync('npm', args, { stdio: 'inherit' });
  return result.status;
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
  // Claude Code's background/alias requests must land on the model the gateway
  // actually serves, not on an Anthropic haiku id the upstream has never heard of.
  applyModelAliases(model);
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
    console.error(t.launch.keyMissing(provider.id ?? '?'));
    return null;
  }
  try {
    return await startGateway({ api: provider.api, apiKey });
  } catch (err) {
    console.error(t.launch.gatewayFailed(provider.api.base_url, err instanceof Error ? err.message : String(err)));
    return null;
  }
}

function warnOllamaTier(provider: Provider, model: string): void {
  const modelDef = provider.models.find((m) => m.id === model);
  // Fall back to the :cloud suffix for models not in the catalog (e.g. user-pulled
  // custom cloud models discovered by refreshOllama before catalog update).
  if (modelDef?.tier === 'subscription') {
    // Probed 2026-07: these 403 on a free account before any token is served.
    console.error(t.launch.ollamaSubscription);
  } else if (modelDef?.signin_required ?? model.endsWith(':cloud')) {
    // Cloud models route through Ollama's hosted backend — needs a free account + CLI signin.
    console.error(t.launch.ollamaCloud);
  } else {
    // Local models load fully into RAM/VRAM; large context KV cache can be many GB -> OOM.
    console.error(t.launch.ollamaLocal);
  }
}

function runOllama(model: string, rest: string[]): void {
  const args = ['launch', 'claude', '--model', model, ...(rest.length ? ['--', ...rest] : [])];
  const result = spawnSync('ollama', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(t.launch.ollamaFailed(result.error.message));
    process.exitCode = 1;
  } else if (result.status !== 0) {
    console.error(t.launch.ollamaExited(result.status, model));
    process.exitCode = result.status ?? 1;
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
    const command = resolveClaude();
    if (!command) {
      console.error(t.launch.claudeNotFound);
      process.exitCode = 1;
      resolve();
      return;
    }
    const child =
      command.kind === 'direct'
        ? spawn(command.file, [...command.args, ...rest], { stdio: 'inherit' })
        : spawn(
            command.comspec,
            ['/d', '/s', '/c', `"${[command.shim, ...rest].map(quoteCmdArg).join(' ')}"`],
            { stdio: 'inherit', windowsVerbatimArguments: true },
          );
    child.on('error', (err) => {
      console.error(t.launch.claudeFailed(err.message));
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
 * Args actually handed to claude: --bare prepended when the provider's quota
 * cannot carry the full prompt, unless the user opted out or passed it already.
 */
export function claudeArgs(provider: Provider, rest: string[]): string[] {
  if (!provider.bare || rest.includes('--bare') || process.env.NEXUS_FULL_PROMPT === '1') return rest;
  console.error(t.launch.bare(provider.name));
  return ['--bare', ...rest];
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
    applyModelAliases(model);
    applyContextWindow(provider, model);
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
    applyContextWindow(provider, model);
    await runClaude(claudeArgs(provider, rest));
    // Close only once claude has exited: the gateway serves every request of the
    // session, and closing it is what lets this process end. Close regardless of
    // claude's exit code — the process is going away either way.
    await gateway.close();
    return;
  }
  applyProviderEnv(provider, model);
  await runClaude(rest);
}
