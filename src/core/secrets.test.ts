import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic: isolated data dir, plaintext store (no PowerShell/DPAPI), and no
// durable OS purge (NEXUS_SKIP_ENV_PURGE) so the run can't touch the real registry.
const dataDir = mkdtempSync(join(tmpdir(), 'nexus-secrets-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';
process.env.NEXUS_SKIP_ENV_PURGE = '1';

const { getSecret, setSecret, deleteSecret, listSecretNames, wipeSecretStore, migrateLegacyEnv, nexusDataDir } = await import(
  './secrets.js'
);

test('set/get/list/delete round-trip', () => {
  setSecret('OPENROUTER_API_KEY', 'or-123');
  assert.equal(getSecret('OPENROUTER_API_KEY'), 'or-123');
  assert.ok(listSecretNames().includes('OPENROUTER_API_KEY'));
  deleteSecret('OPENROUTER_API_KEY');
  assert.equal(getSecret('OPENROUTER_API_KEY'), undefined);
});

test('persists to disk as a plaintext store file', () => {
  setSecret('GROQ_API_KEY', 'g-456');
  const onDisk = JSON.parse(readFileSync(join(dataDir, 'secrets.json'), 'utf8')) as {
    enc: string;
    data: string;
  };
  assert.equal(onDisk.enc, 'plain');
  assert.equal((JSON.parse(onDisk.data) as Record<string, string>).GROQ_API_KEY, 'g-456');
});

test('migrateLegacyEnv imports a leaked global key into the store and purges process.env', () => {
  process.env.MISTRAL_API_KEY = 'leaked-from-env';
  migrateLegacyEnv();
  assert.equal(getSecret('MISTRAL_API_KEY'), 'leaked-from-env', 'key imported into store');
  assert.equal(process.env.MISTRAL_API_KEY, undefined, 'purged from process.env');
});

test('migrateLegacyEnv is idempotent (marker guards re-run)', () => {
  process.env.GEMINI_API_KEY = 'should-not-import-after-marker';
  migrateLegacyEnv(); // marker already written by the previous test -> no-op
  assert.equal(getSecret('GEMINI_API_KEY'), undefined);
});

test('a corrupt store is preserved before the next write', () => {
  writeFileSync(join(dataDir, 'secrets.json'), '{not valid json');
  assert.equal(getSecret('OPENROUTER_API_KEY'), undefined);
  setSecret('OPENROUTER_API_KEY', 'recovered');
  assert.equal(getSecret('OPENROUTER_API_KEY'), 'recovered');
  const corrupt = readdirSync(dataDir).filter((name) => name.startsWith('secrets.json.corrupt-'));
  assert.equal(corrupt.length, 1, 'the damaged store must be kept for recovery');
});

test('nexusDataDir ignores an empty override instead of using the cwd', () => {
  const previous = process.env.NEXUS_DATA_DIR;
  process.env.NEXUS_DATA_DIR = '';
  try {
    assert.equal(nexusDataDir(), join(homedir(), '.nexus-switch'));
  } finally {
    if (previous === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = previous;
  }
});

test('wipeSecretStore removes the data directory', () => {
  setSecret('CEREBRAS_API_KEY', 'c-789');
  wipeSecretStore();
  assert.equal(existsSync(dataDir), false);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
