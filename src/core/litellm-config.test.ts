import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-litellm-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';

// providers/ resolves relative to dist/core (../../providers) — the real catalog.
const { setSecret, deleteSecret } = await import('./secrets.js');
const { buildLitellmConfig } = await import('./litellm-config.js');

test('no provider key present => nothing to serve', () => {
  const cfg = buildLitellmConfig();
  assert.equal(cfg.hasModels, false);
  assert.deepEqual(cfg.keyVars, []);
});

test('only loads model groups whose key exists (C2: no drift)', () => {
  setSecret('GROQ_API_KEY', 'g-key');
  const cfg = buildLitellmConfig();
  assert.equal(cfg.hasModels, true);
  assert.deepEqual(cfg.keyVars, ['GROQ_API_KEY']);
  // Groq models present, keyed to its env var...
  assert.match(cfg.content, /model_name: groq\/llama-3\.3-70b-versatile/);
  assert.match(cfg.content, /api_key: os\.environ\/GROQ_API_KEY/);
  // ...and nothing from providers without a key.
  assert.doesNotMatch(cfg.content, /model_name: gemini\//);
  assert.doesNotMatch(cfg.content, /model_name: cerebras\//);
});

test('injects litellm_settings + master key from the proxy env var', () => {
  setSecret('GROQ_API_KEY', 'g-key');
  const cfg = buildLitellmConfig();
  assert.match(cfg.content, /master_key: os\.environ\/NEXUS_PROXY_KEY/);
  assert.match(cfg.content, /additional_drop_params: \["output_config", "mcp_servers", "container", "thinking"\]/);
  assert.match(cfg.content, /modify_params: true/);
});

test('generation is deterministic (stable hash => no needless proxy restart)', () => {
  setSecret('GROQ_API_KEY', 'g-key');
  setSecret('GEMINI_API_KEY', 'gem-key');
  assert.equal(buildLitellmConfig().content, buildLitellmConfig().content);
  deleteSecret('GEMINI_API_KEY');
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
