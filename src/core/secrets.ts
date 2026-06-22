// Secret store — replaces global env-var persistence (platform/persist.ts).
//
// Why: API keys + the proxy master key used to live in User-scope env vars
// (setx / shell rc). That made them readable by every process the user runs,
// persistent after uninstall, and impossible to scope to a single child.
// This store keeps secrets in ~/.nexus-switch/, never exports them to the
// global env, and injects them only into the spawned child's env.
//
// At-rest protection:
//   - Windows: DPAPI (CurrentUser) via PowerShell ProtectedData. Fallback to
//     plaintext + icacls (owner-only ACL) when PowerShell/DPAPI is unavailable.
//   - Unix: plaintext file with 0600 perms inside a 0700 directory.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Nexus-managed secret names that previously lived as global env vars. */
const LEGACY_ENV_NAMES = [
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'NEXUS_PROXY_KEY',
] as const;

interface StoreFile {
  version: 1;
  /** How `data` is encoded. 'dpapi' => base64 DPAPI blob; 'plain' => UTF-8 JSON. */
  enc: 'plain' | 'dpapi';
  data: string;
}

type Secrets = Record<string, string>;

/**
 * ~/.nexus-switch — single user-scoped data directory (also wiped on uninstall).
 * NEXUS_DATA_DIR overrides it (multi-profile setups; isolated test runs).
 */
export function nexusDataDir(): string {
  return process.env.NEXUS_DATA_DIR ?? join(homedir(), '.nexus-switch');
}

function storePath(): string {
  return join(nexusDataDir(), 'secrets.json');
}

function migrationMarkerPath(): string {
  return join(nexusDataDir(), '.migrated');
}

function ensureDataDir(): void {
  if (existsSync(nexusDataDir())) return;
  mkdirSync(nexusDataDir(), { recursive: true, mode: 0o700 });
}

// --- Windows DPAPI (CurrentUser) via PowerShell -----------------------------

let dpapiAvailable: boolean | null = null;

function runPowerShell(script: string, input: string): string {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
}

const DPAPI_PROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$plain=[Console]::In.ReadToEnd()',
  '$bytes=[System.Text.Encoding]::UTF8.GetBytes($plain)',
  "$enc=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser')",
  '[Console]::Out.Write([Convert]::ToBase64String($enc))',
].join('; ');

const DPAPI_UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd()',
  '$enc=[Convert]::FromBase64String($b64)',
  "$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,'CurrentUser')",
  '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))',
].join('; ');

/** Probe DPAPI once with a round-trip; cache the result for the process. */
function canUseDpapi(): boolean {
  if (process.platform !== 'win32') return false;
  if (process.env.NEXUS_SECRETS_PLAINTEXT === '1') return false; // escape hatch / hermetic tests
  if (dpapiAvailable !== null) return dpapiAvailable;
  try {
    const probe = 'nexus-dpapi-probe';
    const blob = runPowerShell(DPAPI_PROTECT, probe);
    dpapiAvailable = runPowerShell(DPAPI_UNPROTECT, blob) === probe;
  } catch {
    dpapiAvailable = false;
  }
  return dpapiAvailable;
}

function dpapiProtect(plain: string): string {
  return runPowerShell(DPAPI_PROTECT, plain);
}

function dpapiUnprotect(blob: string): string {
  return runPowerShell(DPAPI_UNPROTECT, blob);
}

// --- File-level protection ---------------------------------------------------

/** Restrict the store to the current user (0600 unix, owner-only ACL on win plaintext). */
function lockDownFile(path: string): void {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    if (!user) return;
    try {
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch {
      /* best-effort: ACL hardening unavailable */
    }
    return;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

// --- Read / write store ------------------------------------------------------

function readStore(): Secrets {
  const path = storePath();
  if (!existsSync(path)) return {};
  let file: StoreFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as StoreFile;
  } catch {
    return {};
  }
  try {
    const json = file.enc === 'dpapi' ? dpapiUnprotect(file.data) : file.data;
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Secrets) : {};
  } catch {
    return {};
  }
}

function writeStore(secrets: Secrets): void {
  ensureDataDir();
  const json = JSON.stringify(secrets);
  const useDpapi = canUseDpapi();
  const file: StoreFile = useDpapi
    ? { version: 1, enc: 'dpapi', data: dpapiProtect(json) }
    : { version: 1, enc: 'plain', data: json };
  const path = storePath();
  writeFileSync(path, JSON.stringify(file), { mode: 0o600 });
  lockDownFile(path);
}

// --- Public API --------------------------------------------------------------

export function getSecret(name: string): string | undefined {
  const value = readStore()[name];
  return value ? value : undefined;
}

export function setSecret(name: string, value: string): void {
  const secrets = readStore();
  secrets[name] = value;
  writeStore(secrets);
}

export function deleteSecret(name: string): void {
  const secrets = readStore();
  if (!(name in secrets)) return;
  delete secrets[name];
  writeStore(secrets);
}

export function listSecretNames(): string[] {
  return Object.keys(readStore());
}

/** Remove the whole store directory (uninstall). Best-effort. */
export function wipeSecretStore(): void {
  try {
    rmSync(nexusDataDir(), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// --- Legacy env-var migration ------------------------------------------------

/** Read a legacy global value: current process env, then Windows User registry. */
function readLegacyEnv(name: string): string | undefined {
  const inProcess = process.env[name];
  if (inProcess) return inProcess;
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = out.match(new RegExp(`${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`));
      if (match?.[1]) return match[1].trim();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Purge a global value: Windows registry + current process env, and Unix shell rc. */
export function purgeLegacyEnv(name: string): void {
  delete process.env[name];
  // Opt-out / hermetic tests: keep the in-memory delete but never touch the
  // durable OS store (registry / shell rc), so a test run can't wipe real keys.
  if (process.env.NEXUS_SKIP_ENV_PURGE === '1') return;
  if (process.platform === 'win32') {
    try {
      execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', name, '/f'], { stdio: 'ignore' });
    } catch {
      /* not present in registry */
    }
    return;
  }
  removeShellRcEntry(name);
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

/** Strip the `# nexus-switch:NAME` marker + its following export line from the rc. */
function removeShellRcEntry(name: string): void {
  const rc = shellRc();
  if (!existsSync(rc)) return;
  const marker = `# nexus-switch:${name}`;
  const content = readFileSync(rc, 'utf8');
  if (!content.includes(marker)) return;
  const block = new RegExp(`\\n?${escapeRe(marker)}\\n[^\\n]*\\n?`);
  writeFileSync(rc, content.replace(block, '\n'));
}

/**
 * One-time migration for users upgrading from the env-var era: import any
 * nexus-managed key still in the global env into the store, then purge it from
 * the global env. Guarded by a marker so it runs once. Idempotent and safe.
 */
export function migrateLegacyEnv(): void {
  if (existsSync(migrationMarkerPath())) return;
  const secrets = readStore();
  for (const name of LEGACY_ENV_NAMES) {
    const legacy = readLegacyEnv(name);
    if (legacy && !secrets[name]) {
      secrets[name] = legacy;
    }
  }
  writeStore(secrets);
  for (const name of LEGACY_ENV_NAMES) purgeLegacyEnv(name);
  try {
    ensureDataDir();
    writeFileSync(migrationMarkerPath(), new Date().toISOString());
  } catch {
    /* best-effort: a missing marker just re-runs an idempotent migration */
  }
}
