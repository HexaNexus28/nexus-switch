// E2E harness — drive the REAL built `nexus` binary against FAKE external tools.
//
// The unit suite mocks `spawnSync`, so it is blind by construction to the bugs
// that actually bite users: silent exit from a dirtied stdin/TTY, and tool
// detection across python/pip layouts. These tests run the compiled CLI for
// real and stub the external binaries (claude / pip / litellm) by prepending a
// throwaway bin dir to PATH — no code change needed, since the CLI resolves
// every tool via where/which + spawn. State is isolated through NEXUS_DATA_DIR.

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const here = dirname(fileURLToPath(import.meta.url)); // <root>/dist-e2e/e2e
/** Repo root, from this compiled file's location (dist-e2e/e2e/harness.js). */
export const repoRoot = join(here, '..', '..');
/** The real launcher entrypoint the published package exposes. */
export const nexusBin = join(repoRoot, 'bin', 'nexus.js');

/** A fresh temp dir under the OS temp root (caller is responsible for cleanup). */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Write a fake executable `name` into `binDir`, runnable through PATH the way a
 * real tool is. The behavior is a Node script (`jsBody`); on Windows we add a
 * `.cmd` shim so `where`/PATHEXT resolves it, on POSIX a chmod +x launcher.
 */
export function writeStub(binDir: string, name: string, jsBody: string): void {
  mkdirSync(binDir, { recursive: true });
  const jsPath = join(binDir, `${name}.js`);
  writeFileSync(jsPath, jsBody);
  if (isWin) {
    writeFileSync(join(binDir, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.js" %*\r\n`);
  } else {
    const launcher = join(binDir, name);
    writeFileSync(launcher, `#!/bin/sh\nexec node "${jsPath}" "$@"\n`);
    chmodSync(launcher, 0o755);
  }
}

// The recorder body, used both as a POSIX main script and as a Windows
// `--require` hook. The guard makes the Windows hook a no-op in every node
// process EXCEPT the claude.exe stub (the parent nexus is also node and would
// otherwise run it and exit before doing any work).
function claudeRecorderBody(logPath: string): string {
  return [
    "const path = require('node:path');",
    "const isWinHook = process.platform === 'win32';",
    "if (!isWinHook || path.basename(process.execPath).toLowerCase() === 'claude.exe') {",
    "  const fs = require('node:fs');",
    `  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({`,
    '    argv: process.argv.slice(2),',
    '    stdinIsTTY: Boolean(process.stdin.isTTY),',
    '    baseUrl: process.env.ANTHROPIC_BASE_URL || null,',
    '    authToken: process.env.ANTHROPIC_AUTH_TOKEN || null,',
    '  }));',
    '  process.exit(0);',
    '}',
  ].join('\n');
}

/**
 * Install a fake `claude` that records what it inherited (stdin TTY-ness, the
 * Anthropic env, argv) to `logPath`, then exits 0 — the probe for the silent-
 * exit bug (a clean launch sees `stdinIsTTY: true`).
 *
 * POSIX: a chmod +x shebang script resolves through execvp. Windows is the hard
 * case — the CLI spawns `claude` WITHOUT a shell, so CreateProcess appends .exe
 * and never sees a `.cmd`. We therefore hardlink the real node.exe to
 * `claude.exe` and inject the recorder via NODE_OPTIONS=--require (picked up by
 * buildChildEnv through a marker file), guarded so only the claude.exe run acts.
 */
export function installClaudeStub(binDir: string, logPath: string): void {
  mkdirSync(binDir, { recursive: true });
  const body = claudeRecorderBody(logPath);
  if (process.platform !== 'win32') {
    writeStub(binDir, 'claude', body);
    return;
  }
  const claudeExe = join(binDir, 'claude.exe');
  if (!existsSync(claudeExe)) {
    try {
      linkSync(process.execPath, claudeExe); // instant, same volume
    } catch {
      copyFileSync(process.execPath, claudeExe); // cross-volume fallback
    }
  }
  const hook = join(binDir, 'claude-stub.cjs');
  writeFileSync(hook, body);
  // NODE_OPTIONS treats backslash as an escape, so a Windows path silently loses
  // its separators (C:\a\b -> C:ab -> MODULE_NOT_FOUND, crashing the parent).
  // Forward slashes are valid for --require on Windows and survive the parsing.
  writeFileSync(join(binDir, '.node-options'), `--require "${hook.replace(/\\/g, '/')}"`);
}

/** A `litellm` stub: presence only (proxy is faked separately on :4000). */
export function installLitellmStub(binDir: string): void {
  writeStub(binDir, 'litellm', 'process.exit(0);');
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Dir prepended to PATH so its stubs win over real tools. */
  binDir?: string;
  /** Isolated nexus state dir (secrets, generated config). */
  dataDir: string;
  /** Extra env (e.g. NEXUS_E2E_CLAUDE_LOG). */
  extraEnv?: Record<string, string>;
  /** Piped stdin (also forces a non-TTY run). */
  input?: string;
  timeoutMs?: number;
}

// Real provider keys live in the dev's env; migrateLegacyEnv() would pull them
// into every fresh test store and break isolation. Scrub them so the only state
// is what a test explicitly sets.
const SCRUBBED_VARS = [
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'NEXUS_PROXY_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
];

/** Isolated, scrubbed child env with the stub bin dir winning on PATH. */
function buildChildEnv(opts: { binDir?: string; dataDir: string; extraEnv?: Record<string, string> }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXUS_DATA_DIR: opts.dataDir,
    NEXUS_SECRETS_PLAINTEXT: '1',
  };
  for (const name of SCRUBBED_VARS) delete env[name];
  if (opts.binDir) {
    env.PATH = opts.binDir + delimiter + (process.env.PATH ?? '');
    // Windows claude stub injects itself via NODE_OPTIONS (see installClaudeStub).
    const marker = join(opts.binDir, '.node-options');
    if (existsSync(marker)) {
      const injected = readFileSync(marker, 'utf8').trim();
      env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${injected}` : injected;
    }
  }
  Object.assign(env, opts.extraEnv ?? {});
  return env;
}

/** Run `node bin/nexus.js <args>` with isolated state and a stubbed PATH. */
export function runNexus(args: string[], opts: RunOptions): RunResult {
  const result = spawnSync(process.execPath, [nexusBin, ...args], {
    env: buildChildEnv(opts),
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs ?? 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export interface PtyResult {
  output: string;
  exitCode: number;
}

export interface PtyOptions extends RunOptions {
  /** On first match of `match` in cumulative output, write `send` to the pty. */
  respondTo?: Array<{ match: RegExp; send: string }>;
  /**
   * Resolve as soon as this returns true (then kill the pty), instead of waiting
   * for the child to exit. Windows ConPTY often fails to report the exit once a
   * grandchild inherited the terminal, so once the artifact we care about exists
   * (e.g. the claude log), there is nothing left to wait for.
   */
  until?: () => boolean;
}

/**
 * Run nexus inside a REAL pseudo-terminal. This is the only way to test the
 * interactive path the way a user hits it: the parent has a genuine TTY, so the
 * launched claude can only see an interactive stdin if the launcher handed it
 * over cleanly (the silent-exit regression). Skips gracefully if node-pty has
 * no prebuilt binary for this platform.
 */
export async function runNexusPty(args: string[], opts: PtyOptions): Promise<PtyResult | null> {
  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch {
    return null;
  }
  let child: ReturnType<typeof pty.spawn>;
  try {
    child = pty.spawn(process.execPath, [nexusBin, ...args], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: repoRoot,
      env: buildChildEnv(opts) as Record<string, string>,
    });
  } catch {
    // ConPTY requires a real console window; headless CI runners (no console
    // attached) throw "AttachConsole failed". Skip gracefully.
    return null;
  }
  const pending = [...(opts.respondTo ?? [])];
  let output = '';
  return await new Promise<PtyResult>((resolve) => {
    let done = false;
    const finish = (exitCode: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve({ output, exitCode });
    };
    const timer = setTimeout(() => finish(-1), opts.timeoutMs ?? 30_000);
    const poll = setInterval(() => {
      if (opts.until?.()) finish(0);
    }, 150);
    child.onData((data) => {
      output += data;
      const idx = pending.findIndex((r) => r.match.test(output));
      if (idx !== -1) {
        child.write(pending[idx]!.send);
        pending.splice(idx, 1);
      }
    });
    child.onExit(({ exitCode }) => finish(exitCode));
  });
}
