import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { join } from 'node:path';
import type { ProviderType } from '../types/provider.types.js';
import { generatedConfigPath, litellmDir, writeLitellmConfig } from './litellm-config.js';
import { getSecret, setSecret } from './secrets.js';

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 4000;

/** Marker storing the config hash the running proxy was started with. */
function configMarkerPath(): string {
  return join(litellmDir(), '.proxy-config.hash');
}

/** SHA-256 of the on-disk generated config, or null if it cannot be read. */
function configHash(): string | null {
  try {
    return createHash('sha256').update(readFileSync(generatedConfigPath())).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Does the running proxy reflect the current config? False when no marker
 * exists (proxy started by an older nexus / externally) or the hash differs
 * (config changed after the proxy booted — LiteLLM never hot-reloads it).
 */
function proxyConfigMatches(): boolean {
  const hash = configHash();
  if (!hash) return true; // can't read config -> don't churn the proxy
  try {
    return readFileSync(configMarkerPath(), 'utf8').trim() === hash;
  } catch {
    return false;
  }
}

function writeConfigMarker(): void {
  const hash = configHash();
  if (!hash) return;
  try {
    writeFileSync(configMarkerPath(), hash);
  } catch {
    /* best-effort: a missing marker just forces a restart next time */
  }
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

/** Master key for the gateway, generated once and stored; providers read ${NEXUS_PROXY_KEY}. */
function ensureProxyKey(): string {
  const existing = getSecret('NEXUS_PROXY_KEY');
  if (existing) return existing;
  const key = `sk-nexus-${randomUUID().replace(/-/g, '')}`;
  setSecret('NEXUS_PROXY_KEY', key);
  return key;
}

/** Start the LiteLLM gateway on loopback:4000. Returns whether it is reachable. */
export async function startProxy(): Promise<boolean> {
  const generated = writeLitellmConfig();
  if (!generated.hasModels) {
    // LiteLLM is plumbing (no key of its own); it needs at least one PROVIDER
    // key to have something to route. The keys belong to groq/gemini/etc.
    console.error('Aucune cle provider pour le proxy. Configure : nexus key set groq|gemini|cerebras|mistral|nvidia <cle>');
    return false;
  }
  if (await proxyRunning()) return true;
  const exe = litellmExe();
  if (!exe) {
    console.error('litellm introuvable. Install : pip install "litellm[proxy]"');
    return false;
  }
  const proxyKey = ensureProxyKey();
  // Secrets are injected ONLY into this child's env (never the global env):
  // the master key + each provider key the generated config references.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  childEnv.NEXUS_PROXY_KEY = proxyKey;
  for (const keyVar of generated.keyVars) {
    const value = getSecret(keyVar);
    if (value) childEnv[keyVar] = value;
  }
  // --host 127.0.0.1 : sinon LiteLLM bind 0.0.0.0 -> exposition LAN avec master key connue.
  const child = spawn(exe, ['--config', generated.path, '--host', PROXY_HOST, '--port', String(PROXY_PORT)], {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  });
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    await delay(1000);
    if (await proxyRunning()) {
      writeConfigMarker();
      return true;
    }
  }
  console.error('Proxy LiteLLM sans reponse apres 20s.');
  return false;
}

/** Stop the running proxy, wait for the port to free, then start it fresh. */
export async function restartProxy(): Promise<boolean> {
  stopProxy();
  for (let i = 0; i < 10; i += 1) {
    if (!(await proxyRunning())) break;
    await delay(300);
  }
  return startProxy();
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
  // Refresh the on-disk config from the catalog + present keys before comparing,
  // so a key added/removed since boot is reflected in the hash check.
  writeLitellmConfig();
  if (await proxyRunning()) {
    // A live proxy started with a stale config keeps serving old params
    // (e.g. output_config not dropped -> Groq 400). Restart it on mismatch.
    if (proxyConfigMatches()) return true;
    return restartProxy();
  }
  return startProxy();
}
