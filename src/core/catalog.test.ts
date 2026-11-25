import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshOpenRouter } from './catalog.js';

const model = (id: string): { id: string; name: string; tier: 'quota'; location: 'cloud' } => ({
  id,
  name: id,
  tier: 'quota',
  location: 'cloud',
});

function fixture(): { home: string; file: string; original: string } {
  const home = mkdtempSync(join(tmpdir(), 'nexus-catalog-'));
  const providerDir = join(home, 'providers');
  mkdirSync(providerDir, { recursive: true });
  const file = join(providerDir, 'openrouter.json');
  const original = `${JSON.stringify(
    {
      type: 'openrouter',
      name: 'OpenRouter',
      default: 'a',
      models: [model('a'), model('b')],
    },
    null,
    2,
  )}\n`;
  writeFileSync(file, original);
  return { home, file, original };
}

async function withHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.NEXUS_SWITCH_HOME;
  process.env.NEXUS_SWITCH_HOME = home;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NEXUS_SWITCH_HOME;
    else process.env.NEXUS_SWITCH_HOME = previous;
  }
}

test('refreshOpenRouter refuses an empty upstream list and leaves the file untouched', async () => {
  const { home, file, original } = fixture();
  try {
    await withHome(home, async () => {
      await assert.rejects(
        refreshOpenRouter(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
        /liste de modeles vide/,
      );
    });
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('refreshOpenRouter refuses a malformed payload and leaves the file untouched', async () => {
  const { home, file, original } = fixture();
  try {
    await withHome(home, async () => {
      await assert.rejects(
        refreshOpenRouter(async () => new Response(JSON.stringify({}), { status: 200 })),
        /liste de modeles vide/,
      );
    });
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('refreshOpenRouter keeps only models that still exist upstream, atomically', async () => {
  const { home, file } = fixture();
  try {
    const result = await withHome(home, () =>
      refreshOpenRouter(async () => new Response(JSON.stringify({ data: [{ id: 'a' }] }), { status: 200 })),
    );
    assert.deepEqual(result, { kept: 1, removed: ['b'] });
    const written = JSON.parse(readFileSync(file, 'utf8')) as { models: Array<{ id: string }> };
    assert.deepEqual(written.models.map((m) => m.id), ['a']);
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
