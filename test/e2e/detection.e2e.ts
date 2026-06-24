// E2E: real CLI, fake tools on PATH, isolated state. Non-interactive (piped
// stdin) — the TTY/stdin regression is covered separately in launch-tty.e2e.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installClaudeStub, installLitellmStub, makeTempDir, runNexus, writeStub } from './harness.js';

/**
 * Bring a fake LiteLLM gateway up on the loopback port the CLI probes. Returns
 * null if the port is already taken (e.g. the dev's real proxy is running) —
 * the caller then skips, so a test never kills the user's live gateway.
 */
function fakeProxy(): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', (err: NodeJS.ErrnoException) =>
      err.code === 'EADDRINUSE' ? resolve(null) : reject(err),
    );
    server.listen(4000, '127.0.0.1', () => resolve(server));
  });
}

test('smoke: the built binary runs and lists providers', () => {
  const dataDir = makeTempDir('nexus-e2e-smoke-');
  try {
    const r = runNexus(['help'], { dataDir, input: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Providers\s*:/);
    assert.match(r.stdout, /groq/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('key store is isolated per NEXUS_DATA_DIR', () => {
  const a = makeTempDir('nexus-e2e-keyA-');
  const b = makeTempDir('nexus-e2e-keyB-');
  try {
    assert.equal(runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir: a, input: '' }).status, 0);
    assert.match(runNexus(['key', 'list'], { dataDir: a, input: '' }).stdout, /OK\s+groq/);
    // A different data dir must not see A's key.
    assert.doesNotMatch(runNexus(['key', 'list'], { dataDir: b, input: '' }).stdout, /OK\s+groq/);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('non-TTY groq with no litellm: prints the manual install path and exits 1', () => {
  const dataDir = makeTempDir('nexus-e2e-nolitellm-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  try {
    writeStub(binDir, 'claude', 'process.exit(0);'); // claude present, litellm absent
    runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir, binDir, input: '' });
    const r = runNexus(['groq'], { dataDir, binDir, input: '' });
    assert.equal(r.status, 1, 'must fail cleanly, not crash or hang');
    assert.match(r.stderr, /litellm|pip install/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('groq happy path: builds the gateway env and launches claude', async (t) => {
  const server = await fakeProxy();
  if (!server) {
    t.skip('port 4000 already in use (real proxy running) — cannot run hermetically here');
    return;
  }
  const dataDir = makeTempDir('nexus-e2e-happy-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  try {
    installClaudeStub(binDir, claudeLog);
    installLitellmStub(binDir);
    runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir, binDir, input: '' });
    const r = runNexus(['groq'], {
      dataDir,
      binDir,
      input: '',
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog },
    });
    assert.equal(r.status, 0, `nexus exited non-zero: ${r.stderr}`);
    const seen = JSON.parse(readFileSync(claudeLog, 'utf8')) as { baseUrl: string | null };
    assert.equal(seen.baseUrl, 'http://127.0.0.1:4000', 'claude got the gateway base URL');
  } finally {
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
