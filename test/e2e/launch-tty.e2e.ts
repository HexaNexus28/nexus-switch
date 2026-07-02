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

// Full TUI flow: picker -> in-Ink key prompt -> launch. The key prompt MUST be
// an Ink dialog: a readline prompt after an Ink teardown loses keystrokes on
// Windows (cancelled raw console read), which used to strand the user on
// "Colle ta cle" with a dead keyboard.
test('TUI hub: pick openrouter, enter key in Ink, claude launches', async (t) => {
  const dataDir = makeTempDir('nexus-e2e-tui-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  try {
    installClaudeStub(binDir, claudeLog);
    const result = await runNexusPty([], {
      dataDir,
      binDir,
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog },
      respondTo: [
        // Providers list -> last entry is OpenRouter (7 downs), enter.
        { match: /choisis ta source/, send: '\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\r' },
        // Model picker -> take the first model.
        { match: /OpenRouter\s+·/, send: '\r' },
        // In-Ink key prompt -> paste a key and validate.
        { match: /Cle API openrouter absente/, send: 'or-secret\r' },
      ],
      until: () => existsSync(claudeLog),
      timeoutMs: 25_000,
    });
    if (result === null) {
      t.skip('node-pty has no prebuilt binary on this platform');
      return;
    }
    assert.equal(result.exitCode, 0, `TUI flow never reached claude: ${result.output.slice(-600)}`);
    const seen = JSON.parse(readFileSync(claudeLog, 'utf8')) as { stdinIsTTY: boolean; baseUrl: string | null };
    assert.equal(seen.stdinIsTTY, true, 'claude saw a non-interactive stdin');
    assert.equal(seen.baseUrl, 'https://openrouter.ai/api', 'provider env was applied');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

// Stolen-keystroke regression: a launcher stdin left in flowing mode keeps a
// console read pending (Windows reads the console from a thread, immune to
// spawnSync blocking the loop), which eats the child's first line — the user
// had to click the window before typing reached claude. The stub blocks on a
// real stdin read; if the line we type is stolen by the parent, the stub never
// logs and the test times out.
test('typed input reaches claude right after launch (no stolen first keystrokes)', async (t) => {
  const dataDir = makeTempDir('nexus-e2e-type-');
  const binDir = makeTempDir('nexus-e2e-bin-');
  const claudeLog = join(makeTempDir('nexus-e2e-log-'), 'claude.json');
  try {
    installClaudeStub(binDir, claudeLog);
    const result = await runNexusPty(['openrouter'], {
      dataDir,
      binDir,
      extraEnv: { NEXUS_E2E_CLAUDE_LOG: claudeLog, NEXUS_E2E_CLAUDE_READ: '1' },
      respondTo: [
        // The key prompt makes the launcher read stdin first — the dirtiest path.
        { match: /cle openrouter/i, send: 'or-secret\r' },
        { match: /CLAUDE_STUB_READY/, send: 'hello claude\r' },
      ],
      until: () => existsSync(claudeLog),
      timeoutMs: 20_000,
    });
    if (result === null) {
      t.skip('node-pty has no prebuilt binary on this platform');
      return;
    }
    assert.equal(result.exitCode, 0, `stub never received the typed line: ${result.output.slice(-500)}`);
    const seen = JSON.parse(readFileSync(claudeLog, 'utf8')) as { typed: string | null };
    assert.equal(seen.typed, 'hello claude', 'first typed line was stolen by the launcher');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
