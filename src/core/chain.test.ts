import test from 'node:test';
import assert from 'node:assert/strict';
import type { Provider, ProviderModel } from '../types/provider.types.js';
import { buildRoutes } from './chain.js';

const model = (id: string, over: Partial<ProviderModel> = {}): ProviderModel => ({
  id,
  name: id,
  tier: 'quota',
  location: 'cloud',
  ...over,
});

const gateway = (id: string, order: number | undefined, models: ProviderModel[], def?: string): Provider => ({
  id,
  type: 'gateway',
  name: id.toUpperCase(),
  default: def ?? models[0]!.id,
  models,
  api: { base_url: `https://${id}.example/v1`, model_prefix: `${id}/` },
  ...(order !== undefined ? { fallback_order: order } : {}),
});

const groq = gateway('groq', 5, [model('groq/big', { class: 'large' }), model('groq/small', { class: 'fast' })]);
const cerebras = gateway('cerebras', 1, [model('cerebras/big', { class: 'large' })]);
const gemini = gateway(
  'gemini',
  2,
  [
    model('gemini/pro', { class: 'large' }),
    model('gemini/flash', { class: 'large' }),
    model('gemini/paid', { class: 'large', tier: 'paid' }),
  ],
  'gemini/flash',
);
const mistral = gateway('mistral', 4, [model('mistral/paid', { class: 'large', tier: 'paid' })]);
const unranked = gateway('nvidia', undefined, [model('nvidia/big', { class: 'large' })]);
const openrouter: Provider = { id: 'openrouter', type: 'openrouter', name: 'OR', default: 'x', models: [model('x', { class: 'large' })] };
const all = [groq, cerebras, gemini, mistral, unranked, openrouter];

const everyKey = (id: string) => `key-${id}`;

test('automatic chain: same class, by fallback_order, provider default preferred, paid never', () => {
  const routes = buildRoutes(groq, 'groq/big', all, everyKey);
  assert.deepEqual(
    routes.map((r) => r.model),
    ['groq/big', 'cerebras/big', 'gemini/flash'], // mistral only has a paid model; nvidia is unranked
  );
  assert.equal(routes[1]!.apiKey, 'key-cerebras');
});

test('providers without a key are left out', () => {
  const keys = (id: string) => (id === 'cerebras' ? undefined : `key-${id}`);
  assert.deepEqual(buildRoutes(groq, 'groq/big', all, keys).map((r) => r.providerId), ['groq', 'gemini']);
});

test('a fast model only falls back to fast models', () => {
  assert.deepEqual(buildRoutes(groq, 'groq/small', all, everyKey).map((r) => r.model), ['groq/small']);
});

test('manual chain wins over fallback_order and may include unranked providers', () => {
  const routes = buildRoutes(groq, 'groq/big', all, everyKey, ['nvidia', 'gemini', 'unknown']);
  assert.deepEqual(routes.map((r) => r.providerId), ['groq', 'nvidia', 'gemini']);
});

test('a model without class gets no fallback; a non-gateway primary gets no route', () => {
  const plain = gateway('plain', 3, [model('plain/m')]);
  assert.deepEqual(buildRoutes(plain, 'plain/m', all, everyKey).map((r) => r.model), ['plain/m']);
  assert.deepEqual(buildRoutes(openrouter, 'x', all, everyKey), []);
});

test('Groq carries its request ceiling into the route', () => {
  const capped = gateway('groq', 5, [model('groq/big', { class: 'large', context: 131072 })]);
  capped.max_request_tokens = 8000;
  const [route] = buildRoutes(capped, 'groq/big', [], everyKey);
  assert.equal(route!.maxRequestTokens, 8000);
  assert.equal(route!.context, 131072);
});
