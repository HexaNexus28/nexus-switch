import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import * as net from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-proxy-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';

// Deterministic "proxy not running": the TCP probe always errors out.
class FakeSocket {
  private handlers: Record<string, () => void> = {};
  setTimeout(): void {}
  once(event: string, cb: () => void): this {
    this.handlers[event] = cb;
    return this;
  }
  connect(): this {
    setImmediate(() => this.handlers.error?.());
    return this;
  }
  destroy(): void {}
}
mock.module('node:net', { namedExports: { ...net, Socket: FakeSocket } });

// `litellm` is "not installed": litellmExe() resolves to null, so startProxy
// bails before the spawn/poll loop — fast and environment-independent.
const spawnSyncCalls: string[] = [];
mock.module('node:child_process', {
  namedExports: {
    ...childProcess, // keep execFileSync etc. that secrets.ts imports
    spawnSync: (cmd: string) => {
      spawnSyncCalls.push(cmd);
      return { status: 1, stdout: '' };
    },
    spawn: () => ({ unref() {} }),
  },
});

const { setSecret, deleteSecret } = await import('./secrets.js');
const { generatedConfigPath } = await import('./litellm-config.js');
const { ensureProxyForProvider } = await import('./proxy.js');

test('non-litellm providers are a no-op (no proxy, no config write)', async () => {
  spawnSyncCalls.length = 0;
  const ok = await ensureProxyForProvider('anthropic');
  assert.equal(ok, true);
  assert.equal(spawnSyncCalls.length, 0, 'never probes for litellm');
});

test('litellm with a key: regenerates config and attempts to start the gateway', async () => {
  setSecret('GROQ_API_KEY', 'g-key');
  const ok = await ensureProxyForProvider('litellm');
  assert.equal(ok, false, 'litellm binary missing => start fails cleanly');
  assert.ok(existsSync(generatedConfigPath()), 'config was generated');
  assert.match(readFileSync(generatedConfigPath(), 'utf8'), /model_name: groq\//);
});

test('litellm without any PROVIDER key: nothing to route, refuses before spawn', async () => {
  deleteSecret('GROQ_API_KEY');
  const ok = await ensureProxyForProvider('litellm');
  assert.equal(ok, false);
  assert.doesNotMatch(readFileSync(generatedConfigPath(), 'utf8'), /model_name:/);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
