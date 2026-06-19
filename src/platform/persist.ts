import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Persist a key as an environment variable that survives across terminals.
 * Windows: User-scope env var (registry). Unix: managed line in the shell rc.
 * The current process env is updated immediately in both cases.
 */
export function persistKey(varName: string, value: string): void {
  process.env[varName] = value;
  if (process.platform === 'win32') {
    spawnSync('setx', [varName, value], { stdio: 'ignore' });
    return;
  }
  upsertShellRc(varName, value);
}

function shellRc(): string {
  const shell = process.env.SHELL ?? '';
  if (shell.includes('zsh')) return join(homedir(), '.zshrc');
  if (shell.includes('fish')) return join(homedir(), '.config', 'fish', 'config.fish');
  return join(homedir(), '.bashrc');
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertShellRc(varName: string, value: string): void {
  const rc = shellRc();
  const marker = `# nexus-switch:${varName}`;
  const line = rc.endsWith('config.fish')
    ? `set -gx ${varName} "${value}"`
    : `export ${varName}="${value}"`;
  const existing = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
  if (existing.includes(marker)) {
    const block = new RegExp(`${escapeRe(marker)}\\n[^\\n]*`);
    writeFileSync(rc, existing.replace(block, `${marker}\n${line}`));
  } else {
    appendFileSync(rc, `\n${marker}\n${line}\n`);
  }
}
