import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { Provider } from './types/provider.types.js';
import { keyVarFor, readKey, setKey } from './core/keys.js';
import { claudeExists, runNpm } from './core/launch.js';
import { t } from './i18n/index.js';

/**
 * Ensure the `claude` CLI is available. If absent, offer an opt-in npm install
 * on an interactive terminal; otherwise print the manual command. Never installs
 * silently. Returns whether claude is usable after the call.
 */
export async function ensureClaude(): Promise<boolean> {
  if (claudeExists()) return true;
  console.error(t.setup.claudeMissing);
  if (!process.stdin.isTTY) {
    console.error(t.setup.claudeInstallHint);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(t.setup.claudeInstallAsk)).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error(t.setup.claudeInstallAborted);
    return false;
  }
  runNpm(['i', '-g', '@anthropic-ai/claude-code']);
  return claudeExists();
}

/** Locally-pulled Ollama model names, or null if `ollama` itself can't be run. */
function ollamaInstalledModels(): Set<string> | null {
  const result = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (result.error) return null; // ollama not on PATH -> let launch() report it
  if (result.status !== 0 || !result.stdout) return new Set();
  const ids = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/).slice(1)) {
    const name = line.split(/\s+/)[0];
    if (name) ids.add(name);
  }
  return ids;
}

/** A bare id (no tag) matches its `:latest` form, the way `ollama pull` stores it. */
function ollamaHasModel(model: string, installed: Set<string>): boolean {
  if (installed.has(model)) return true;
  return !model.includes(':') && installed.has(`${model}:latest`);
}

/**
 * Pure check for the TUI: does this LOCAL model need an `ollama pull` first?
 * Cloud models and an unreachable ollama both pass (launch() reports those).
 */
export function ollamaModelMissing(model: string): boolean {
  if (model.endsWith(':cloud')) return false;
  const installed = ollamaInstalledModels();
  return installed !== null && !ollamaHasModel(model, installed);
}

/**
 * Ensure a local Ollama model is pulled before launch. Cloud (`:cloud`) models
 * are served by Ollama's backend (no local pull) and pass through. If a local
 * model is missing, offer an opt-in `ollama pull` on a TTY (downloads can be
 * several GB); otherwise print the manual command. Prevents the "model not
 * found" API error from Claude Code hitting an absent model.
 */
export async function ensureOllamaModel(model: string): Promise<boolean> {
  if (model.endsWith(':cloud')) return true;
  const installed = ollamaInstalledModels();
  if (installed === null || ollamaHasModel(model, installed)) return true;
  console.error(t.setup.ollamaMissing(model));
  if (!process.stdin.isTTY) {
    console.error(t.setup.ollamaPullHint(model));
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(t.setup.ollamaPullAsk(model))).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error(t.setup.ollamaPullAborted(model));
    return false;
  }
  const pull = spawnSync('ollama', ['pull', model], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.error(t.setup.ollamaPullFailed(model));
    return false;
  }
  return true;
}

/**
 * Ensure the provider's API key is in the store before launch — the cloud
 * analogue of `ensureOllamaModel`'s auto-pull. Providers that need no
 * nexus-managed key (Ollama, native Anthropic) pass through. If the key is
 * missing, prompt for it on a TTY and persist it (same as `nexus key set`);
 * otherwise print the manual command. Stops a launch from 401-ing on an empty
 * ANTHROPIC_AUTH_TOKEN.
 */
export async function ensureProviderKey(provider: Provider): Promise<boolean> {
  const varName = provider.id ? keyVarFor(provider.id) : undefined;
  if (!varName) return true; // ollama / anthropic-native: no nexus-managed key
  if (readKey(varName)) return true;
  console.error(t.setup.keyMissing(provider.id ?? '?', varName));
  if (!process.stdin.isTTY) {
    console.error(t.setup.keySetHint(provider.id ?? '?'));
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(t.setup.keyAsk(provider.id ?? '?'))).trim();
  rl.close();
  if (!answer) {
    console.error(t.setup.keyAborted(provider.id ?? '?'));
    return false;
  }
  setKey(varName, answer);
  console.error(t.setup.keySaved(varName));
  return true;
}