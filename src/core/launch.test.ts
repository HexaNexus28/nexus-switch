import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '../types/provider.types.js';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-launch-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';

// Record every spawnSync call instead of really launching ollama/claude.
// This is the no-DI seam: we replace the module, not inject a dependency.
interface SpawnCall {
  cmd: string;
  args: readonly string[];
}
const calls: SpawnCall[] = [];
mock.module('node:child_process', {
  namedExports: {
    ...childProcess, // keep execFileSync etc. that secrets.ts imports
    spawnSync: (cmd: string, args: readonly string[] = []) => {
      calls.push({ cmd, args });
      return { status: 0 };
    },
    spawn: () => ({ unref() {} }),
  },
});

const { setSecret } = await import('./secrets.js');
setSecret('OPENROUTER_API_KEY', 'or-key');
const { launch } = await import('./launch.js');

const ollama = (): Provider => ({
  type: 'ollama',
  name: 'Ollama',
  default: 'llama3',
  models: [{ id: 'llama3', name: 'Llama 3', free: true }],
});

const openrouter = (): Provider => ({
  type: 'openrouter',
  name: 'OpenRouter',
  default: 'openrouter/owl-alpha',
  models: [{ id: 'openrouter/owl-alpha', name: 'Owl', free: true }],
  env: {
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: '${OPENROUTER_API_KEY}',
    ANTHROPIC_API_KEY: '',
  },
});

test('ollama: routes to `ollama launch claude` and resets stale overrides first', () => {
  calls.length = 0;
  process.env.ANTHROPIC_BASE_URL = 'http://stale:4000';
  launch(ollama(), 'llama3', []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cmd, 'ollama');
  assert.deepEqual(calls[0]!.args, ['launch', 'claude', '--model', 'llama3']);
  assert.equal(process.env.ANTHROPIC_BASE_URL, undefined); // reset ran before launch
});

test('ollama: forwards passthrough flags after `--`', () => {
  calls.length = 0;
  launch(ollama(), 'llama3', ['--dangerously-skip-permissions']);
  assert.deepEqual(calls[0]!.args, ['launch', 'claude', '--model', 'llama3', '--', '--dangerously-skip-permissions']);
});

test('openrouter: builds the Anthropic env from the store, then spawns claude', () => {
  calls.length = 0;
  launch(openrouter(), 'openrouter/owl-alpha', ['-p', 'hello']);
  // Correct binary + passthrough args.
  assert.equal(calls[0]!.cmd, 'claude');
  assert.deepEqual(calls[0]!.args, ['-p', 'hello']);
  // Env wired correctly for the child claude to reach OpenRouter.
  assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, 'or-key');
  assert.equal(process.env.ANTHROPIC_MODEL, 'openrouter/owl-alpha');
  assert.equal(process.env.MAX_THINKING_TOKENS, '0'); // non-claude => thinking disabled
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
