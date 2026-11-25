// E2E harness — drive the REAL built `nexus` binary against FAKE external tools.
//
// The unit suite mocks `spawnSync`, so it is blind by construction to the bugs
// that actually bite users: silent exit from a dirtied stdin/TTY, and tool
// detection across python/pip layouts. These tests run the compiled CLI for
// real and stub the external binaries (claude / python) by prepending a
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
//
// With NEXUS_E2E_CLAUDE_READ=1 the stub additionally announces itself, then
// BLOCKS on a synchronous stdin read until a full line arrives — the probe for
// the stolen-keystroke bug (a parent that kept a console read pending eats the
// line; the stub then never logs and the test times out). Sync read only: the
// hook must not return, or node would start its REPL and fight for stdin.
function claudeRecorderBody(logPath: string): string {
  return [
    "const path = require('node:path');",
    "const isWinHook = process.platform === 'win32';",
    "if (!isWinHook || path.basename(process.execPath).toLowerCase() === 'claude.exe') {",
    "  const fs = require('node:fs');",
    "  let typed = null;",
    "  if (process.env.NEXUS_E2E_CLAUDE_READ === '1') {",
    "    process.stdout.write('CLAUDE_STUB_READY\\n');",
    '    typed = \'\';',
    '    const buf = Buffer.alloc(256);',
    "    while (!/[\\r\\n]/.test(typed)) {",
    '      const n = fs.readSync(0, buf, 0, 256, null);',
    '      if (n <= 0) break;',
    "      typed += buf.toString('utf8', 0, n);",
    '    }',
    '    typed = typed.trim();',
    '  }',
    `  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({`,
    '    argv: process.argv.slice(2),',
    '    stdinIsTTY: Boolean(process.stdin.isTTY),',
    '    baseUrl: process.env.ANTHROPIC_BASE_URL || null,',
    '    authToken: process.env.ANTHROPIC_AUTH_TOKEN || null,',
    '    typed,',
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
  installClaudeBody(binDir, 'claude-stub', claudeRecorderBody(logPath));
}

/**
 * Install a fake `claude` that runs `body` (a CommonJS Node script) instead of
 * the real CLI: POSIX gets a shebang launcher, Windows a node.exe hardlink plus
 * a NODE_OPTIONS hook (see installClaudeStub).
 */
function installClaudeBody(binDir: string, hookName: string, body: string): void {
  if (process.platform !== 'win32') {
    writeStub(binDir, 'claude', body);
    return;
  }
  mkdirSync(binDir, { recursive: true });
  linkNodeAs(binDir, 'claude.exe');
  const hook = join(binDir, `${hookName}.cjs`);
  writeFileSync(hook, body);
  appendNodeRequire(binDir, hook);
}

/**
 * Install a fake claude that, instead of talking to a model, issues ONE real
 * request to the gateway it inherited (`ANTHROPIC_BASE_URL`) and records how the
 * gateway answered.
 *
 * Used with a deliberately wrong bearer token, so the expected answer is a 401
 * from the gateway's own auth guard: that proves the gateway was alive and
 * routing *while claude was running*, without touching the network. A gateway
 * that cannot answer (e.g. a parent blocked in spawnSync) shows up as the
 * timeout recorded here rather than as a hung suite.
 */
export function installClaudeProbe(binDir: string, logPath: string): void {
  installClaudeBody(binDir, 'claude-probe', claudeProbeBody(logPath));
}

function claudeProbeBody(logPath: string): string {
  return [
    "const path = require('node:path');",
    "const isWinHook = process.platform === 'win32';",
    "if (!isWinHook || path.basename(process.execPath).toLowerCase() === 'claude.exe') {",
    "  const fs = require('node:fs');",
    "  const http = require('node:http');",
    `  const LOG = ${JSON.stringify(logPath)};`,
    '  const finish = (payload) => {',
    '    try { fs.writeFileSync(LOG, JSON.stringify(payload)); } catch {}',
    '    process.exit(0);',
    '  };',
    "  const base = process.env.ANTHROPIC_BASE_URL || '';",
    "  if (!base) { finish({ error: 'ANTHROPIC_BASE_URL not set' }); }",
    "  const target = new URL('/v1/messages', base);",
    "  const payload = JSON.stringify({ model: 'probe', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });",
    '  const req = http.request(',
    '    {',
    '      hostname: target.hostname,',
    '      port: target.port,',
    '      path: target.pathname,',
    "      method: 'POST',",
    "      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: 'Bearer wrong-token' },",
    '    },',
    '    (res) => {',
    '      res.resume();',
    '      finish({ status: res.statusCode });',
    '    },',
    '  );',
    "  req.on('error', (err) => finish({ error: err.message }));",
    '  req.setTimeout(8000, () => {',
    '    req.destroy();',
    "    finish({ error: 'timeout: gateway never answered' });",
    '  });',
    '  req.write(payload);',
    '  req.end();',
    '}',
  ].join('\n');
}

/**
 * Append a `--require <hook>` to the bin dir's NODE_OPTIONS marker (created on
 * first use), so several recorders can share one process.
 *
 * NODE_OPTIONS treats backslash as an escape, so a Windows path silently loses
 * its separators (C:\a\b -> C:ab -> MODULE_NOT_FOUND, crashing the parent).
 * Forward slashes are valid for --require on Windows and survive the parsing.
 */
function appendNodeRequire(binDir: string, hookPath: string): void {
  mkdirSync(binDir, { recursive: true });
  const marker = join(binDir, '.node-options');
  const spec = `--require "${hookPath.replace(/\\/g, '/')}"`;
  const existing = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  writeFileSync(marker, existing ? `${existing} ${spec}` : spec);
}

/**
 * Record the argv nexus hands to `claude`, observed from INSIDE the nexus
 * process by patching child_process.
 *
 * Why not read it off the stub: the Windows stub is a hardlink of node.exe
 * (CreateProcess without a shell never resolves a `.cmd`), so node's own option
 * parser eats any flag it also owns — `claude.exe -p bonjour` is read as
 * `node -p bonjour` and `process.argv` no longer holds either token. That makes
 * the stub blind to passthrough flags exactly where it matters. Patching the
 * spawn call observes what nexus passed, identically on every platform, and
 * `claude` resolving or exiting is left to whatever stub is installed.
 */
export function installSpawnRecorder(binDir: string, logPath: string): void {
  const hook = join(binDir, 'spawn-recorder.cjs');
  const body = [
    "const cp = require('node:child_process');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const LOG = ${JSON.stringify(logPath)};`,
    'const isClaude = (cmd) =>',
    "  typeof cmd === 'string' && path.basename(cmd).toLowerCase().replace(/\\.exe$/, '') === 'claude';",
    "for (const fn of ['spawnSync', 'spawn']) {",
    '  const real = cp[fn];',
    "  if (typeof real !== 'function') continue;",
    '  cp[fn] = function (cmd, args, ...rest) {',
    '    if (isClaude(cmd)) {',
    '      try {',
    "        fs.appendFileSync(LOG, JSON.stringify({ cmd, args: Array.isArray(args) ? args : [] }) + '\\n');",
    '      } catch { /* recording is best-effort */ }',
    '    }',
    '    return real.apply(this, [cmd, args, ...rest]);',
    '  };',
    '}',
  ].join('\n');
  writeFileSync(hook, body);
  appendNodeRequire(binDir, hook);
}

/** Hardlink the running node.exe into binDir under `exeName` (spawn-without-shell resolvable). */
function linkNodeAs(binDir: string, exeName: string): void {
  const target = join(binDir, exeName);
  if (existsSync(target)) return;
  try {
    linkSync(process.execPath, target); // instant, same volume
  } catch {
    copyFileSync(process.execPath, target); // cross-volume fallback
  }
}

/**
 * Neutralize the machine's real Python (legacy LiteLLM-path helper, kept for
 * hermetic detection stubs):
 * pythonScriptDirs() asks python/python3/py where pip's script dirs live, which
 * finds a REAL off-PATH litellm on the dev box and breaks the "litellm absent"
 * scenario. On Windows the stubs must be .exe (spawn without shell never sees
 * .cmd), so we link node.exe under the python names: node choking on python
 * argv (`-c <code>`) exits non-zero with no stdout, which the probes treat as
 * "no usable interpreter". POSIX gets plain exit-1 scripts.
 */
export function installPythonStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  for (const name of ['python', 'python3', 'py']) {
    if (isWin) linkNodeAs(binDir, `${name}.exe`);
    else writeStub(binDir, name, 'process.exit(1);');
  }
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Dir prepended to PATH so its stubs win over real tools. */
  binDir?: string;
  /**
   * 'stub-only' builds a PATH from binDir + node + system dirs, hiding any real
   * claude/npm installed on the machine. Required to test a `.cmd` shim without
   * a later native claude.exe winning the lookup.
   */
  pathMode?: 'stub-only';
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
function buildChildEnv(opts: {
  binDir?: string;
  pathMode?: 'stub-only';
  dataDir: string;
  extraEnv?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXUS_DATA_DIR: opts.dataDir,
    NEXUS_SECRETS_PLAINTEXT: '1',
    NEXUS_NO_UPDATE_CHECK: '1', // no registry traffic from tests
  };
  for (const name of SCRUBBED_VARS) delete env[name];
  if (opts.binDir) {
    if (opts.pathMode === 'stub-only') {
      const win = process.env.WINDIR ?? 'C:\\Windows';
      const systemDirs =
        process.platform === 'win32' ? [join(win, 'System32'), win] : ['/usr/bin', '/bin'];
      env.PATH = [opts.binDir, dirname(process.execPath), ...systemDirs].join(delimiter);
    } else {
      env.PATH = opts.binDir + delimiter + (process.env.PATH ?? '');
    }
    // Windows stubs/recorders inject themselves via NODE_OPTIONS (see
    // installClaudeStub / installSpawnRecorder).
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

export interface PtySkip {
  skipped: string;
}

export type PtyOutcome = PtyResult | PtySkip;

export interface PtyOptions extends RunOptions {
  /** On first match of `match` in cumulative output, write `send` to the pty. */
  respondTo?: Array<{ match: RegExp; send: string }>;
  /**
   * Delay before writing a matched response. Ink swaps input handlers between
   * screens; a write delivered in the same tick as the new screen's first
   * render can land before the new useInput handler exists and be lost.
   */
  settleMs?: number;
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
export async function runNexusPty(args: string[], opts: PtyOptions): Promise<PtyOutcome> {
  // ConPTY (Windows pseudo-terminal) requires an attached console window.
  // Headless CI runners have no console, so node-pty's conpty_console_list_agent
  // throws "AttachConsole failed" when spawning -- not catchable from JS since
  // it happens in a subprocess. Detect this pre-spawn via the standard CI env
  // var. NOTE: do NOT gate on process.stdout.isTTY — node --test already pipes
  // stdout for every test file, which made all three PTY tests skip forever.
  if (process.env.CI === 'true' && process.platform === 'win32') {
    return { skipped: 'ConPTY requires an interactive console (CI)' };
  }
  if (process.env.NEXUS_E2E_PTY === '0') return { skipped: 'NEXUS_E2E_PTY=0' };

  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch (err) {
    return { skipped: `node-pty indisponible: ${err instanceof Error ? err.message : String(err)}` };
  }
  const child = pty.spawn(process.execPath, [nexusBin, ...args], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: repoRoot,
    env: buildChildEnv(opts) as Record<string, string>,
  });
  const pending = [...(opts.respondTo ?? [])];
  const sends = new Set<NodeJS.Timeout>();
  let output = '';
  return await new Promise<PtyResult>((resolve) => {
    let done = false;
    const finish = (exitCode: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      for (const pendingSend of sends) clearTimeout(pendingSend);
      sends.clear();
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
      if (idx === -1) return;
      const matched = pending.splice(idx, 1)[0];
      if (!matched) return;
      const { send } = matched;
      if (process.env.NEXUS_E2E_DEBUG === '1') {
        console.error(`[pty] match ${matched.match} -> send ${JSON.stringify(send)}`);
      }
      const write = (): void => {
        try {
          child.write(send);
        } catch {
          /* pty already gone */
        }
      };
      if (opts.settleMs) {
        const handle = setTimeout(() => {
          sends.delete(handle);
          write();
        }, opts.settleMs);
        sends.add(handle);
      } else {
        write();
      }
    });
    child.onExit(({ exitCode }) => finish(exitCode));
  });
}
