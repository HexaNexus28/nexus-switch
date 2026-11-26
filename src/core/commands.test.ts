import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../i18n/en.js';
import { fr } from '../i18n/fr.js';
import { closest, COMMAND_FLAGS, COMMANDS, renderHelp, resolveCommand } from './commands.js';

const PROVIDERS = ['anthropic', 'cerebras', 'gemini', 'groq', 'mistral', 'nvidia', 'ollama', 'openrouter'];
const ALL = [...COMMANDS, ...PROVIDERS];

test('every command and flag is in the help, in every language', () => {
  for (const messages of [en, fr]) {
    const help = renderHelp(messages, PROVIDERS, '9.9.9');
    for (const name of COMMANDS) assert.match(help, new RegExp(`nexus ${name}\\b`), name);
    for (const flag of Object.keys(COMMAND_FLAGS)) assert.ok(help.includes(flag), flag);
    assert.ok(help.includes('9.9.9'));
    assert.ok(help.includes('NEXUS_LANG'));
    for (const p of PROVIDERS) assert.ok(help.includes(p), p);
  }
});

test('flags resolve to their command, providers do not', () => {
  assert.equal(resolveCommand('--version'), 'version');
  assert.equal(resolveCommand('-h'), 'help');
  assert.equal(resolveCommand('doctor'), 'doctor');
  assert.equal(resolveCommand('groq'), undefined);
});

test('typos map to the intended command or provider', () => {
  assert.equal(closest('groc', ALL), 'groq');
  assert.equal(closest('gemnii', ALL), 'gemini'); // transposition
  assert.equal(closest('Groq', ALL), 'groq'); // case
  assert.equal(closest('unistall', ALL), 'uninstall');
  assert.equal(closest('doc', ALL), 'doctor'); // unique prefix
  assert.equal(closest('--versoin', Object.keys(COMMAND_FLAGS)), '--version');
  assert.equal(closest('lsit', ['set', 'list', 'delete']), 'list');
});

test('no guess when nothing is close or the prefix is ambiguous', () => {
  assert.equal(closest('banana', ALL), undefined);
  assert.equal(closest('xyz', ALL), undefined);
  assert.equal(closest('', ALL), undefined);
  assert.equal(closest('o', ALL), undefined); // ollama/openrouter, too short anyway
});
