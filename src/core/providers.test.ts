import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated catalog dir + hermetic secrets before importing the module.
const dataDir = mkdtempSync(join(tmpdir(), 'nexus-providers-'));
const catalogDir = join(dataDir, 'providers');
mkdirSync(catalogDir, { recursive: true });
process.env.NEXUS_SWITCH_HOME = dataDir;

const { loadAllProviders, loadProvider, listProviders } = await import('./providers.js');

// Two healthy catalogs, one stale (old "litellm" type from a pre-refactor
// version) and one corrupt JSON — exactly the upgrade-debris scenarios.
writeFileSync(
  join(catalogDir, 'groq.json'),
  JSON.stringify({
    type: 'gateway',
    name: 'Groq',
    default: 'groq/llama-3.3-70b-versatile',
    api: { base_url: 'https://api.groq.com/openai/v1', model_prefix: 'groq/' },
    models: [{ id: 'groq/llama-3.3-70b-versatile', name: 'Llama', tier: 'quota', location: 'cloud' }],
  }),
);
writeFileSync(
  join(catalogDir, 'ollama.json'),
  JSON.stringify({
    type: 'ollama',
    name: 'Ollama',
    default: 'llama3',
    models: [{ id: 'llama3', name: 'Llama 3', tier: 'free', location: 'local' }],
  }),
);
writeFileSync(
  join(catalogDir, 'nvidia.json'),
  JSON.stringify({ type: 'litellm', name: 'NVIDIA', default: 'x', models: [{ id: 'x', name: 'X', tier: 'quota', location: 'cloud' }] }),
);
writeFileSync(join(catalogDir, 'broken.json'), '{ not json');

test('loadAllProviders skips invalid catalogs with a warning and loads the healthy ones', () => {
  const warnings: string[] = [];
  const originalError = console.error;
  console.error = (msg: unknown) => warnings.push(String(msg));
  try {
    const providers = loadAllProviders();
    assert.equal(providers.length, 2, 'healthy catalogs loaded, invalid ones skipped');
    assert.deepEqual(
      providers.map((p) => p.id).sort(),
      ['groq', 'ollama'],
    );
    assert.equal(
      warnings.some((w) => w.includes('nvidia') && w.includes('litellm')),
      true,
      'stale-type catalog reported with its validation reason',
    );
    assert.equal(
      warnings.some((w) => w.includes('broken')),
      true,
      'corrupt JSON catalog reported too',
    );
  } finally {
    console.error = originalError;
  }
});

test('loadProvider still fails hard for a specific broken provider', () => {
  assert.throws(() => loadProvider('nvidia'), /invalid type "litellm"/);
});

test('listProviders lists every json file regardless of validity', () => {
  assert.deepEqual(listProviders().sort(), ['broken', 'groq', 'nvidia', 'ollama']);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
