import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'nexus-update-'));
process.env.NEXUS_DATA_DIR = dataDir;
delete process.env.NEXUS_NO_UPDATE_CHECK;

const { availableUpdate, CURRENT_VERSION, isNewer, refreshUpdateCache } = await import('./update.js');
const cacheFile = join(dataDir, 'update-check.json');

const registry = (version: string, calls: string[]): typeof fetch =>
  (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ version }), { status: 200 });
  }) as typeof fetch;

test('isNewer compares x.y.z numerically, not as strings', () => {
  assert.equal(isNewer('1.4.10', '1.4.9'), true);
  assert.equal(isNewer('1.4.1', '1.4.1'), false);
  assert.equal(isNewer('1.3.9', '1.4.0'), false);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
});

test('newer version on npm: cached, then announced; no network on the read side', async () => {
  const calls: string[] = [];
  await refreshUpdateCache(registry('99.0.0', calls));
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /registry\.npmjs\.org\/@hexanexus\/nexus-switch\/latest/);
  assert.equal(availableUpdate(), '99.0.0');
});

test('checked less than a day ago: registry not polled again', async () => {
  const calls: string[] = [];
  await refreshUpdateCache(registry('100.0.0', calls));
  assert.equal(calls.length, 0);
});

test('same version published: no notice', () => {
  writeFileSync(cacheFile, JSON.stringify({ checkedAt: Date.now(), latest: CURRENT_VERSION }));
  assert.equal(availableUpdate(), null);
});

test('offline / registry error: never throws, cache untouched', async () => {
  writeFileSync(cacheFile, JSON.stringify({ checkedAt: 0, latest: '1.0.0' }));
  await refreshUpdateCache((async () => {
    throw new Error('offline');
  }) as typeof fetch);
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8')).latest, '1.0.0');
});

test('NEXUS_NO_UPDATE_CHECK=1 disables both sides', async () => {
  writeFileSync(cacheFile, JSON.stringify({ checkedAt: 0, latest: '99.0.0' }));
  process.env.NEXUS_NO_UPDATE_CHECK = '1';
  const calls: string[] = [];
  await refreshUpdateCache(registry('99.0.0', calls));
  assert.equal(calls.length, 0);
  assert.equal(availableUpdate(), null);
  delete process.env.NEXUS_NO_UPDATE_CHECK;
});
