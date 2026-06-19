import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderType } from '../types/provider.types.js';
import { persistKey, readPersistedKey } from '../platform/persist.js';

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 4000;

const LITELLM_KEY_VARS = [
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'CLOUDFLARE_API_TOKEN',
] as const;

const moduleDir = dirname(fileURLToPath(import.meta.url));

function litellmConfigPath(): string {
  const home = process.env.NEXUS_SWITCH_HOME;
  const root = home ?? join(moduleDir, '..', '..');
  return join(root, 'litellm', 'litellm-config.yaml');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** TCP probe of 127.0.0.1:4000 — is the LiteLLM gateway up? */
export function proxyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (up: boolean): void => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(PROXY_PORT, PROXY_HOST);
  });
}

function hasAnyLiteLLMKey(): boolean {
  return LITELLM_KEY_VARS.some((v) => Boolean(process.env[v]));
}

function litellmExe(): string | null {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, ['litellm'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find(Boolean);
  return first ? first.trim() : null;
}

/** Is the litellm CLI on PATH? Only the LiteLLM-backed providers need it. */
export function litellmExists(): boolean {
  return litellmExe() !== null;
}

/** Master key for the gateway, generated once and persisted; providers read ${NEXUS_PROXY_KEY}. */
function ensureProxyKey(): string {
  const existing = readPersistedKey('NEXUS_PROXY_KEY');
  if (existing) {
    process.env.NEXUS_PROXY_KEY = existing;
    return existing;
  }
  const key = `sk-nexus-${randomUUID().replace(/-/g, '')}`;
  persistKey('NEXUS_PROXY_KEY', key);
  return key;
}

/** Start the LiteLLM gateway on loopback:4000. Returns whether it is reachable. */
export async function startProxy(): Promise<boolean> {
  const config = litellmConfigPath();
  if (!existsSync(config)) {
    console.error('litellm-config.yaml introuvable.');
    return false;
  }
  if (!hasAnyLiteLLMKey()) {
    console.error('Aucune cle LiteLLM. Configure : nexus key set groq|gemini|cerebras|mistral|nvidia <cle>');
    return false;
  }
  if (await proxyRunning()) return true;
  const exe = litellmExe();
  if (!exe) {
    console.error('litellm introuvable. Install : pip install "litellm[proxy]"');
    return false;
  }
  ensureProxyKey();
  // --host 127.0.0.1 : sinon LiteLLM bind 0.0.0.0 -> exposition LAN avec master key connue.
  const child = spawn(exe, ['--config', config, '--host', PROXY_HOST, '--port', String(PROXY_PORT)], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    await delay(1000);
    if (await proxyRunning()) return true;
  }
  console.error('Proxy LiteLLM sans reponse apres 20s.');
  return false;
}

export function stopProxy(): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/IM', 'litellm.exe', '/F'], { stdio: 'ignore' });
  } else {
    spawnSync('pkill', ['-f', 'litellm'], { stdio: 'ignore' });
  }
}

/** Ensure the gateway is up for LiteLLM-backed providers; no-op for the others. */
export async function ensureProxyForProvider(type: ProviderType): Promise<boolean> {
  if (type !== 'litellm') return true;
  if (await proxyRunning()) return true;
  return startProxy();
}
