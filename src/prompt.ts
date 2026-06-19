import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { claudeExists } from './core/launch.js';

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
