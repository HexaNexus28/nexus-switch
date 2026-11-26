import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostic, issueUrl, redact } from './report.js';
import type { Diagnostic } from '../types/report.types.js';

test('redact masks stored key values of any shape, known key formats, tokens and the home path', () => {
  const custom = 'my-weird-provider-key-123456';
  const text = [
    `stored=${custom}`,
    'groq=gsk_abcdefghijklmnop1234',
    'gemini=AIzaSyA1234567890abcdefghijk',
    'auth: Bearer nexus-session-1234-abcd',
    'path=C:\\Users\\yawo\\.nexus-switch\\gateway.log',
  ].join('\n');
  const out = redact(text, [custom], 'C:\\Users\\yawo');
  assert.ok(!out.includes(custom));
  assert.ok(!out.includes('gsk_abcdefghijklmnop1234'));
  assert.ok(!out.includes('AIzaSyA1234567890abcdefghijk'));
  assert.ok(!out.includes('nexus-session-1234-abcd'));
  assert.ok(!out.includes('yawo'));
  assert.ok(out.includes('path=~\\.nexus-switch\\gateway.log'));
});

test('redact ignores too-short stored values instead of masking common substrings', () => {
  assert.equal(redact('node v22', ['v2'], ''), 'node v22');
});

const diagnostic: Diagnostic = {
  nexus: '1.4.2',
  node: 'v22.0.0',
  os: 'win32 10.0.26300 x64',
  locale: 'fr',
  shell: 'Git Bash (MINGW64)',
  terminal: 'Windows Terminal',
  stdinTty: true,
  claude: '2.1.200 · native binary',
  ollama: 'not installed',
  keys: { groq: true, gemini: false },
  store: { exists: true, enc: 'dpapi', corruptBackups: 1 },
  logs: { 'secrets-errors.log': ['2026-11-26 secrets.json: bad decrypt'] },
};

test('formatDiagnostic carries presence flags only and the log tails', () => {
  const text = formatDiagnostic(diagnostic);
  assert.match(text, /keys\s+groq=yes gemini=no/);
  assert.match(text, /store\s+dpapi · 1 corrupt backup\(s\)/);
  assert.match(text, /--- secrets-errors\.log \(last 1\)\nbad decrypt|bad decrypt/);
});

test('issueUrl targets the bug form and stays under the GitHub URL limit', () => {
  const short = issueUrl('https://github.com/o/r/issues', 'hello');
  const url = new URL(short);
  assert.equal(url.pathname, '/o/r/issues/new');
  assert.equal(url.searchParams.get('template'), 'bug.yml');
  assert.equal(url.searchParams.get('diagnostic'), 'hello');

  const long = issueUrl('https://github.com/o/r/issues', 'é'.repeat(20_000));
  assert.ok(long.length <= 7500, `url length ${long.length}`);
  assert.match(new URL(long).searchParams.get('diagnostic') ?? '', /\[truncated/);
});
