import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { claudeExists } from './core/launch.js';
import { litellmExists } from './core/proxy.js';

/** Resolve how to invoke pip, or null if neither `pip` nor `python -m pip` is available. */
function pipCommand(): { cmd: string; prefix: string[] } | null {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  if (spawnSync(probe, ['pip'], { stdio: 'ignore' }).status === 0) return { cmd: 'pip', prefix: [] };
  if (spawnSync('python', ['-m', 'pip', '--version'], { stdio: 'ignore' }).status === 0) {
    return { cmd: 'python', prefix: ['-m', 'pip'] };
  }
  return null;
}

/**
 * Ensure the `claude` CLI is available. If absent, offer an opt-in npm install
 * on an interactive terminal; otherwise print the manual command. Never installs
 * silently. Returns whether claude is usable after the call.
 */
export async function ensureClaude(): Promise<boolean> {
  if (claudeExists()) return true;
  console.error('Claude Code CLI absent. Nexus lance Claude Code, ce n’est pas un agent autonome.');
  if (!process.stdin.isTTY) {
    console.error('Install : npm i -g @anthropic-ai/claude-code');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Installer maintenant via npm ? [o/N] ')).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error('Abandon. Install manuelle : npm i -g @anthropic-ai/claude-code');
    return false;
  }
  spawnSync('npm', ['i', '-g', '@anthropic-ai/claude-code'], { stdio: 'inherit' });
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
  console.error(`Modele Ollama '${model}' non installe localement.`);
  if (!process.stdin.isTTY) {
    console.error(`Telecharge-le : ollama pull ${model}`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Telecharger maintenant via 'ollama pull ${model}' ? Peut etre volumineux (plusieurs Go). [o/N] `)).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error(`Abandon. Telecharge-le : ollama pull ${model}`);
    return false;
  }
  const pull = spawnSync('ollama', ['pull', model], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.error(`Echec du pull de '${model}'.`);
    return false;
  }
  return true;
}

/**
 * Ensure the litellm CLI is available for LiteLLM-backed providers. Offers an opt-in
 * pip install only when pip and a TTY are present; otherwise prints the manual command.
 */
export async function ensureLitellm(): Promise<boolean> {
  if (litellmExists()) return true;
  console.error('LiteLLM absent (requis pour les providers via gateway : groq, gemini, cerebras, mistral, nvidia).');
  const pip = pipCommand();
  if (!pip || !process.stdin.isTTY) {
    console.error('Install : pip install "litellm[proxy]"');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Installer LiteLLM via pip maintenant ? [o/N] ')).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error('Abandon. Install manuelle : pip install "litellm[proxy]"');
    return false;
  }
  spawnSync(pip.cmd, [...pip.prefix, 'install', 'litellm[proxy]'], { stdio: 'inherit' });
  return litellmExists();
}
