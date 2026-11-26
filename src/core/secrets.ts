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
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { t } from '../i18n/index.js';

/** Nexus-managed secret names that previously lived as global env vars. */
const LEGACY_ENV_NAMES = [
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'NVIDIA_NIM_API_KEY',
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
  const configured = process.env.NEXUS_DATA_DIR;
  // An empty value must mean "default", not the current working directory:
  // uninstall recursively deletes this path.
  return configured && configured.trim() ? configured : join(homedir(), '.nexus-switch');
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

/** Set when the last read could not decode the store (corrupt JSON / DPAPI). */
let storeReadError: string | null = null;
let storeErrorLogged = false;

function noteStoreError(path: string, err: unknown): void {
  storeReadError = err instanceof Error ? err.message : String(err);
  if (storeErrorLogged) return;
  storeErrorLogged = true;
  try {
    appendFileSync(
      join(nexusDataDir(), 'secrets-errors.log'),
      `${new Date().toISOString()} ${path}: ${storeReadError}\n`,
    );
  } catch {
    /* diagnostics are best-effort */
  }
}

export interface SecretStoreInfo {
  exists: boolean;
  enc: StoreFile['enc'] | 'unreadable' | null;
  /** `secrets.json.corrupt-*` files left by a store that failed to decode. */
  corruptBackups: number;
}

/** Store health for diagnostics (`nexus report`) — never returns secret values. */
export function secretStoreInfo(): SecretStoreInfo {
  const path = storePath();
  const corruptBackups = existsSync(nexusDataDir())
    ? readdirSync(nexusDataDir()).filter((f) => f.startsWith('secrets.json.corrupt-')).length
    : 0;
  if (!existsSync(path)) return { exists: false, enc: null, corruptBackups };
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as StoreFile;
    return { exists: true, enc: file.enc, corruptBackups };
  } catch {
    return { exists: true, enc: 'unreadable', corruptBackups };
  }
}

function readStore(): Secrets {
  const path = storePath();
  if (!existsSync(path)) {
    storeReadError = null;
    return {};
  }
  let file: StoreFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as StoreFile;
  } catch (err) {
    noteStoreError(path, err);
    return {};
  }
  try {
    const json = file.enc === 'dpapi' ? dpapiUnprotect(file.data) : file.data;
    const parsed = JSON.parse(json) as unknown;
    storeReadError = null;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Secrets) : {};
  } catch (err) {
    noteStoreError(path, err);
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

  // A store that failed to decode must never be silently overwritten: keep the
  // damaged file next to the new one so a key can be recovered by hand.
  if (storeReadError && existsSync(path)) {
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    } catch {
      /* best effort: the atomic write below still replaces the file */
    }
  }

  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
  lockDownFile(tmp);
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(file), { mode: 0o600 });
    lockDownFile(path);
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
  storeReadError = null;
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

/**
 * Versions <= 1.4.0 generated a LiteLLM proxy config here. The native gateway
 * replaced the proxy: drop the leftover so nothing hints it is still used.
 */
export function purgeLegacyLitellm(): void {
  try {
    rmSync(join(nexusDataDir(), 'litellm'), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Remove the whole store directory (uninstall). Best-effort. */
export function wipeSecretStore(): void {
  const dir = nexusDataDir();
  const resolved = resolve(dir);
  // NEXUS_DATA_DIR is user-controlled (profiles/tests). Never let a typo turn
  // uninstall into `rm -rf ~` or `rm -rf /`.
  if (
    resolved === parse(resolved).root ||
    resolved === resolve(homedir()) ||
    resolved === resolve(process.cwd())
  ) {
    console.error(t.secrets.refuseWipe(dir));
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
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
