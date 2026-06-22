import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '../types/provider.types.js';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-env-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';
// Set BEFORE importing env.js so its ORIGINAL_ENV snapshot captures it.
process.env.ANTHROPIC_API_KEY = 'sk-ant-user';

const { applyProviderEnv, resetProviderEnv, isAnthropicNative } = await import('./env.js');
const { setSecret } = await import('./secrets.js');
setSecret('OPENROUTER_API_KEY', 'or-key');

const openrouter = (): Provider => ({
  type: 'openrouter',
  name: 'OpenRouter',
  default: 'openrouter/owl-alpha',
  models: [{ id: 'openrouter/owl-alpha', name: 'Owl', free: true, location: 'cloud' }],
  env: {
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: '${OPENROUTER_API_KEY}',
    ANTHROPIC_API_KEY: '',
  },
});

const anthropic = (): Provider => ({
  type: 'anthropic',
  name: 'Anthropic',
  default: 'claude-sonnet-4-6',
  models: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', free: false, location: 'cloud' }],
  env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}' },
});

test('isAnthropicNative: native anthropic + claude (bare and gateway-prefixed) are native', () => {
  assert.equal(isAnthropicNative('anthropic', 'claude-sonnet-4-6'), true);
  assert.equal(isAnthropicNative('openrouter', 'claude-sonnet-4-6'), true);
  assert.equal(isAnthropicNative('openrouter', 'anthropic/claude-sonnet-4-6'), true);
});

test('isAnthropicNative: non-claude models are NOT native (C1 covers OpenRouter too)', () => {
  assert.equal(isAnthropicNative('openrouter', 'openrouter/owl-alpha'), false);
  assert.equal(isAnthropicNative('litellm', 'groq/llama-3.3-70b-versatile'), false);
});

test('OpenRouter non-claude: env resolved from store + thinking disabled', () => {
  resetProviderEnv();
  applyProviderEnv(openrouter(), 'openrouter/owl-alpha');
  assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, 'or-key'); // ${OPENROUTER_API_KEY} from store
  assert.equal(process.env.ANTHROPIC_MODEL, 'openrouter/owl-alpha');
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined); // empty template => deleted (C3)
  assert.equal(process.env.MAX_THINKING_TOKENS, '0');
  assert.equal(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, '1');
});

test('OpenRouter claude model: thinking NOT disabled (model-keyed rule)', () => {
  resetProviderEnv();
  applyProviderEnv(openrouter(), 'anthropic/claude-sonnet-4-6');
  assert.equal(process.env.MAX_THINKING_TOKENS, undefined);
  assert.equal(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, undefined);
});

test('Anthropic: API key survives the universal reset via the env snapshot', () => {
  resetProviderEnv(); // deletes ANTHROPIC_API_KEY from process.env
  applyProviderEnv(anthropic(), 'claude-sonnet-4-6');
  assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-user'); // restored from ORIGINAL_ENV
  assert.equal(process.env.ANTHROPIC_BASE_URL, undefined); // empty => unset
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, undefined);
});

test('resetProviderEnv clears stale provider overrides', () => {
  process.env.ANTHROPIC_BASE_URL = 'http://stale:4000';
  resetProviderEnv();
  assert.equal(process.env.ANTHROPIC_BASE_URL, undefined);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
