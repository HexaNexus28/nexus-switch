import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayRoute } from '../types/gateway.types.js';
import { candidates, cooldownMs, NETWORK_ERROR, routeKey, shouldFallback } from './router.js';

const route = (providerId: string, over: Partial<GatewayRoute> = {}): GatewayRoute => ({
  providerId,
  providerName: providerId,
  api: { base_url: `https://${providerId}.example/v1`, model_prefix: `${providerId}/` },
  apiKey: 'k',
  model: `${providerId}/m`,
  ...over,
});

test('quota, overload and outages fall back; client errors do not', () => {
  for (const s of [413, 429, 502, 503, 504, 529, NETWORK_ERROR]) assert.equal(shouldFallback(s), true, String(s));
  for (const s of [400, 401, 403, 404, 422, 500]) assert.equal(shouldFallback(s), false, String(s));
});

test('cooldown honours Retry-After (seconds or date), caps it, and skips 413', () => {
  const now = Date.parse('2026-11-26T10:00:00Z');
  assert.equal(cooldownMs(429, '30', now), 30_000);
  assert.equal(cooldownMs(429, 'Wed, 26 Nov 2026 10:02:00 GMT', now), 120_000);
  assert.equal(cooldownMs(429, '99999', now), 15 * 60_000);
  assert.equal(cooldownMs(429, null, now), 60_000);
  assert.equal(cooldownMs(503, 'garbage', now), 60_000);
  assert.equal(cooldownMs(413, '30', now), 0);
});

test('candidates: primary first, cooling-down routes skipped, primary back after the window', () => {
  const [a, b, c] = [route('a'), route('b'), route('c')];
  const cool = new Map([[routeKey(a), 1000]]);
  assert.deepEqual(candidates([a, b, c], cool, 500, 10).map((r) => r.providerId), ['b', 'c']);
  assert.deepEqual(candidates([a, b, c], cool, 1000, 10).map((r) => r.providerId), ['a', 'b', 'c']);
});

test('candidates: fallbacks too small for the request are skipped, the primary never is', () => {
  const groq = route('groq', { maxRequestTokens: 8000 });
  const small = route('small', { context: 16_000 });
  const big = route('big');
  assert.deepEqual(candidates([groq, small, big], new Map(), 0, 20_000).map((r) => r.providerId), ['groq', 'big']);
  assert.deepEqual(candidates([big, groq, small], new Map(), 0, 5_000).map((r) => r.providerId), ['big', 'groq', 'small']);
});

test('candidates: everything cooling down -> still try the primary for its real answer', () => {
  const [a, b] = [route('a'), route('b')];
  const cool = new Map([[routeKey(a), 9e15], [routeKey(b), 9e15]]);
  assert.deepEqual(candidates([a, b], cool, 0, 10).map((r) => r.providerId), ['a']);
});
