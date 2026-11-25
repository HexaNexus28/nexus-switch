import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '../types/provider.types.js';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-launch-'));
process.env.NEXUS_DATA_DIR = dataDir;
process.env.NEXUS_SECRETS_PLAINTEXT = '1';

// Record every spawn/spawnSync call instead of really launching ollama/claude.
// This is the no-DI seam: we replace the module, not inject a dependency.
interface SpawnCall {
  cmd: string;
  args: readonly string[];
}
const calls: SpawnCall[] = [];
/** Status returned by the next non-resolver spawnSync (ollama/npm). */
let spawnStatus = 0;
mock.module('node:child_process', {
  namedExports: {
    ...childProcess, // keep execFileSync etc. that secrets.ts imports
    spawnSync: (cmd: string, args: readonly string[] = []) => {
      calls.push({ cmd, args });
      // resolveClaude() probes where/which; every other tool is the launch itself.
      if (cmd === 'where' || cmd === 'which') return { status: 0, stdout: 'claude\n' };
      return { status: spawnStatus };
    },
    // claude is launched with an async spawn (the in-process gateway must keep
    // serving while it runs), so the fake child is a real emitter: it records
    // synchronously and reports a clean exit on the next tick.
    spawn: (cmd: string, args: readonly string[] = []) => {
      calls.push({ cmd, args });
      const child = new EventEmitter() as EventEmitter & { unref(): void };
      child.unref = () => {};
      process.nextTick(() => child.emit('exit', 0, null));
      return child;
    },
  },
});

const { setSecret } = await import('./secrets.js');
setSecret('OPENROUTER_API_KEY', 'or-key');
const { claudeArgs, launch } = await import('./launch.js');

const ollama = (): Provider => ({
  type: 'ollama',
  name: 'Ollama',
  default: 'llama3',
  models: [{ id: 'llama3', name: 'Llama 3', tier: 'free', location: 'local' }],
});

const openrouter = (): Provider => ({
  type: 'openrouter',
  name: 'OpenRouter',
  default: 'nvidia/nemotron-3.5-lightning:free',
  models: [{ id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron', tier: 'quota', location: 'cloud' }],
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
  launch(openrouter(), 'nvidia/nemotron-3.5-lightning:free', ['-p', 'hello']);
  // Correct binary + passthrough args (the first call is the where/which probe).
  const claudeCall = calls.find((call) => call.cmd === 'claude');
  assert.ok(claudeCall, `claude was not spawned: ${JSON.stringify(calls)}`);
  assert.deepEqual(claudeCall.args, ['-p', 'hello']);
  // Env wired correctly for the child claude to reach OpenRouter.
  assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, 'or-key');
  assert.equal(process.env.ANTHROPIC_MODEL, 'nvidia/nemotron-3.5-lightning:free');
  assert.equal(process.env.MAX_THINKING_TOKENS, '0'); // non-claude => thinking disabled
  assert.equal(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'nvidia/nemotron-3.5-lightning:free');
  assert.equal(process.env.ANTHROPIC_SMALL_FAST_MODEL, 'nvidia/nemotron-3.5-lightning:free');
});

test('ollama: propagates a non-zero ollama exit code', () => {
  calls.length = 0;
  spawnStatus = 2;
  launch(ollama(), 'llama3', []);
  assert.equal(process.exitCode, 2);
  spawnStatus = 0;
  process.exitCode = undefined;
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('bare provider: --bare prepended once, opt-out honored', () => {
  const groq: Provider = {
    type: 'gateway', name: 'Groq', default: 'groq/m', bare: true,
    models: [{ id: 'groq/m', name: 'M', tier: 'quota', location: 'cloud' }],
    api: { base_url: 'https://x', model_prefix: 'groq/' },
  };
  assert.deepEqual(claudeArgs(groq, ['-p', 'hi']), ['--bare', '-p', 'hi']);
  assert.deepEqual(claudeArgs(groq, ['--bare', '-p', 'hi']), ['--bare', '-p', 'hi']);
  process.env.NEXUS_FULL_PROMPT = '1';
  assert.deepEqual(claudeArgs(groq, ['-p', 'hi']), ['-p', 'hi']);
  delete process.env.NEXUS_FULL_PROMPT;
  assert.deepEqual(claudeArgs({ ...groq, bare: undefined }, ['-p', 'hi']), ['-p', 'hi']);
});
