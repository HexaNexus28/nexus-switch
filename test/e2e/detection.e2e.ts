// E2E: real CLI, fake tools on PATH, isolated state. Non-interactive (piped
// stdin) — the TTY/stdin regression is covered separately in launch-tty.e2e.ts.
//
// Since the native gateway refactor, gateway-typed providers (groq, gemini,
// cerebras, mistral) no longer need the LiteLLM proxy: launch() boots an
// in-process loopback HTTP server on an ephemeral port and points claude at it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installClaudeProbe, installClaudeStub, installSpawnRecorder, makeTempDir, runNexus, writeStub } from './harness.js';

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

test('groq without a key: fails cleanly with the manual command, no crash', () => {
  const dataDir = makeTempDir('nexus-e2e-nokey-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  try {
    writeStub(binDir, 'claude', 'process.exit(0);');
    const r = runNexus(['groq'], { dataDir, binDir, input: '' });
    assert.equal(r.status, 1, 'must fail cleanly, not crash or hang');
    assert.match(r.stderr, /nexus key set/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('groq happy path: boots the in-process gateway and launches claude against it', () => {
  const dataDir = makeTempDir('nexus-e2e-happy-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  try {
    installClaudeStub(binDir, claudeLog);
    runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir, binDir, input: '' });
    const r = runNexus(['groq'], {
      dataDir,
      binDir,
      input: '',
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog },
    });
    assert.equal(r.status, 0, `nexus exited non-zero: ${r.stderr}`);
    const seen = JSON.parse(readFileSync(claudeLog, 'utf8')) as { baseUrl: string | null };
    // The native gateway binds an ephemeral loopback port — anything on 127.0.0.1
    // proves the env handoff worked without hard-coding a port.
    assert.match(seen.baseUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, 'claude got the loopback gateway base URL');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

// Deadlock regression: the gateway is an HTTP server inside the nexus process,
// and claude was launched with a BLOCKING spawnSync — which froze the event loop
// for the whole session. The gateway accepted claude's connection but never
// answered it, so claude hung on its first /v1/messages (and the gateway log
// stayed empty). The probe stub issues a real request to the gateway while the
// session runs: a deadlock surfaces as a recorded timeout instead.
test('gateway stays responsive while claude runs (no event-loop deadlock)', () => {
  const dataDir = makeTempDir('nexus-e2e-deadlock-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const probeLog = join(makeTempDir('nexus-e2e-probe-'), 'probe.json');
  try {
    installClaudeProbe(binDir, probeLog);
    runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir, binDir, input: '' });
    const r = runNexus(['groq'], { dataDir, binDir, input: '' });
    assert.equal(r.status, 0, `nexus exited non-zero: ${r.stderr}`);
    const seen = JSON.parse(readFileSync(probeLog, 'utf8')) as { status?: number; error?: string };
    // The probe sends a wrong token, so a 401 is the gateway itself answering.
    assert.equal(seen.status, 401, `gateway did not answer claude: ${JSON.stringify(seen)}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

// Passthrough regression: `nexus <provider> [model] [-- claude flags]` must NOT
// forward the literal `--` separator. claude treats args after `--` as
// positional, so `nexus groq -- -p "..."` used to start an interactive session
// and hang instead of printing the answer. The argv is read from inside the
// nexus process (installSpawnRecorder), because on Windows the claude stub is a
// hardlink of node.exe and node would swallow `-p` before the stub can see it.
test('nexus groq -- <flags>: the -- separator is stripped before claude', () => {
  const dataDir = makeTempDir('nexus-e2e-passthrough-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  const spawnLog = join(makeTempDir('nexus-e2e-spawn-'), 'spawn.jsonl');
  try {
    installClaudeStub(binDir, claudeLog);
    installSpawnRecorder(binDir, spawnLog);
    runNexus(['key', 'set', 'groq', 'g-secret'], { dataDir, binDir, input: '' });
    const r = runNexus(['groq', '--', '-p', 'bonjour'], {
      dataDir,
      binDir,
      input: '',
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog },
    });
    assert.equal(r.status, 0, `nexus exited non-zero: ${r.stderr}`);
    const calls = readFileSync(spawnLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] });
    const last = calls.at(-1);
    assert.ok(last, 'nexus never spawned claude');
    // Exact match pins both halves of the regression: no literal `--`, and the
    // flags survive intact.
    assert.deepEqual(last.args, ['-p', 'bonjour'], `claude argv: ${JSON.stringify(last.args)}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
