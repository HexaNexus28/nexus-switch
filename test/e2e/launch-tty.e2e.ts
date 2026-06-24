// E2E regression test for the silent-exit bug: after an interactive prompt, the
// launched claude must inherit a real TTY stdin. If the launcher leaves stdin
// paused/non-TTY, claude falls back to `--print` and exits immediately, dumping
// the user back to the shell with no message.
//
// Driven through a real pseudo-terminal (node-pty) so the parent genuinely has a
// TTY — a spawnSync pipe could never tell a clean handoff from a broken one.
// Uses `openrouter` (a key prompt, no LiteLLM gateway) so the test exercises the
// prompt -> launch stdin handoff without depending on a free :4000.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installClaudeStub, makeTempDir, runNexusPty } from './harness.js';

test('claude inherits an interactive TTY after a readline prompt', async (t) => {
  const dataDir = makeTempDir('nexus-e2e-pty-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  try {
    installClaudeStub(binDir, claudeLog);
    const result = await runNexusPty(['openrouter'], {
      dataDir,
      binDir,
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog },
      // No key set -> the launcher prompts for it; answering dirties stdin.
      respondTo: [{ match: /cle openrouter/i, send: 'or-secret\r' }],
      until: () => existsSync(claudeLog),
      timeoutMs: 20_000,
    });
    if (result === null) {
      t.skip('node-pty has no prebuilt binary on this platform');
      return;
    }
    const seen = JSON.parse(readFileSync(claudeLog, 'utf8')) as { stdinIsTTY: boolean; baseUrl: string | null };
    assert.equal(seen.stdinIsTTY, true, 'claude saw a non-interactive stdin -> silent-exit regression');
    assert.equal(seen.baseUrl, 'https://openrouter.ai/api', 'provider env was applied');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
