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
