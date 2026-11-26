import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GatewayRoute } from '../types/gateway.types.js';
import { startGateway, type RunningGateway } from './server.js';

// --- Mock OpenAI-compatible upstream -----------------------------------------

interface UpstreamCapture {
  auth: string | undefined;
  body: Record<string, unknown>;
}

let upstream: Server;
let upstreamUrl: string;
let captured: UpstreamCapture[] = [];
/** Behavior switch for the next upstream response. */
let mode: 'json' | 'stream' | 'stream-groq' | 'abort' | 'error429' | 'error413' = 'json';

function upstreamListen(): Promise<void> {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      captured.push({
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      if (mode === 'error413') {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'TPM: Limit 8000, Requested 24368', type: 'tokens' } }));
        return;
      }
      if (mode === 'error429') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'TPM limit 8000, requested 29631', type: 'tokens' } }));
        return;
      }
      if (mode === 'stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"id":"c1","choices":[{"delta":{"content":"hi"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (mode === 'stream-groq') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"id":"c1","choices":[{"delta":{"content":"hi"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write(
          'data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":77,"completion_tokens":3}}}\n\n',
        );
        res.end();
        return;
      }
      if (mode === 'abort') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"id":"c1","choices":[{"delta":{"content":"partial"}}]}\n\n');
        setTimeout(() => res.destroy(), 10);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-1',
          choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

let gateway: RunningGateway;

test.before(async () => {
  await upstreamListen();
  gateway = await startGateway({
    routes: [
      {
        providerId: 'groq',
        providerName: 'Groq',
        api: { base_url: upstreamUrl, model_prefix: 'groq/' },
        apiKey: 'sk-provider-secret',
        model: 'groq/qwen/qwen3.6-27b',
      },
    ],
  });
});

test.after(async () => {
  await gateway.close();
  upstream.close();
});

function callGateway(
  path: string,
  body: Record<string, unknown>,
  token?: string,
  target: RunningGateway = gateway,
): Promise<Response> {
  return fetch(`${target.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token ?? target.token}`,
    },
    body: JSON.stringify(body),
  });
}

const request = (over: Record<string, unknown>): Record<string, unknown> => ({
  model: 'groq/qwen/qwen3.6-27b',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'ping' }],
  ...over,
});

test('rejects a wrong session token with an Anthropic-shaped 401', async () => {
  captured = [];
  const res = await callGateway('/v1/messages', request({}), 'wrong');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { type: string; error: { type: string } };
  assert.equal(body.error.type, 'authentication_error');
  assert.equal(captured.length, 0); // never reached the provider
});

test('non-stream: prefix stripped, provider key injected, whitelist enforced, response translated', async () => {
  mode = 'json';
  captured = [];
  const res = await callGateway('/v1/messages', request({ output_config: { effort: 'high' }, thinking: { type: 'disabled' } }));
  assert.equal(res.status, 200);
  const sent = captured[0]!;
  assert.equal(sent.auth, 'Bearer sk-provider-secret');
  assert.equal(sent.body.model, 'qwen/qwen3.6-27b');
  assert.ok(!('output_config' in sent.body), 'output_config leaked to provider');
  assert.ok(!('thinking' in sent.body), 'thinking leaked to provider');
  const msg = (await res.json()) as { model: string; content: unknown[]; usage: { input_tokens: number } };
  assert.equal(msg.model, 'groq/qwen/qwen3.6-27b'); // requested id echoed back to claude
  assert.deepEqual(msg.content, [{ type: 'text', text: 'pong' }]);
  assert.equal(msg.usage.input_tokens, 5);
});

test('stream: upstream OpenAI SSE comes back as Anthropic SSE', async () => {
  mode = 'stream';
  captured = [];
  const res = await callGateway('/v1/messages', request({ stream: true }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(captured[0]!.body.stream, true);
  assert.deepEqual(captured[0]!.body.stream_options, { include_usage: true });
  const text = await res.text();
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(events, [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ]);
  assert.match(text, /"text":"hi"/);
  assert.match(text, /"input_tokens":10/);
});

test('stream: Groq x_groq usage reaches message_delta', async () => {
  mode = 'stream-groq';
  const res = await callGateway('/v1/messages', request({ stream: true }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"usage":\{"input_tokens":77,"output_tokens":3\}/);
  mode = 'json';
});

test('upstream stream interruption emits an SSE error, not message_stop', async () => {
  mode = 'abort';
  const res = await callGateway('/v1/messages', request({ stream: true }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /event: error/);
  assert.match(text, /api_error/);
  assert.doesNotMatch(text, /event: message_stop/);
  mode = 'json';
});

test('upstream error keeps its status and message in Anthropic error shape', async () => {
  mode = 'error429';
  const res = await callGateway('/v1/messages', request({}));
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: { type: string; message: string } };
  assert.equal(body.error.type, 'rate_limit_error');
  assert.match(body.error.message, /TPM limit 8000/);
  mode = 'json';
});

test('provider 413 (token quota) becomes a readable 400, never the 32MB message', async () => {
  mode = 'error413';
  const res = await callGateway('/v1/messages', request({}));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { type: string; message: string } };
  assert.equal(body.error.type, 'invalid_request_error');
  assert.match(body.error.message, /Limit 8000/);
  assert.match(body.error.message, /--bare/);
  mode = 'json';
});

test('count_tokens returns an estimate without touching the provider', async () => {
  captured = [];
  const res = await callGateway('/v1/messages/count_tokens', request({}));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { input_tokens: number };
  assert.ok(body.input_tokens > 0);
  assert.equal(captured.length, 0);
});

test('unknown endpoint -> Anthropic-shaped 404', async () => {
  const res = await callGateway('/v1/complete', request({}));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { type: string } };
  assert.equal(body.error.type, 'not_found_error');
});

// --- Fallback between providers ------------------------------------------------
// A second upstream that fails on demand; the healthy mock above is the fallback.

let flaky: Server;
let flakyUrl: string;
let flakyHits = 0;
let flakyStatus = 429;

function flakyListen(): Promise<void> {
  flaky = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      flakyHits += 1;
      res.writeHead(flakyStatus, { 'content-type': 'application/json', 'retry-after': '30' });
      res.end(JSON.stringify({ error: { message: `flaky ${flakyStatus}` } }));
    });
  });
  return new Promise((resolve) => {
    flaky.listen(0, '127.0.0.1', () => {
      flakyUrl = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

const flakyRoute = (): GatewayRoute => ({
  providerId: 'flaky',
  providerName: 'Flaky',
  api: { base_url: flakyUrl, model_prefix: 'flaky/' },
  apiKey: 'sk-flaky',
  model: 'flaky/big',
});

const healthyRoute = (): GatewayRoute => ({
  providerId: 'cerebras',
  providerName: 'Cerebras',
  api: { base_url: upstreamUrl, model_prefix: 'cerebras/' },
  apiKey: 'sk-cerebras',
  model: 'cerebras/gpt-oss-120b',
});

async function withGateway(routes: GatewayRoute[], run: (g: RunningGateway) => Promise<void>): Promise<void> {
  const g = await startGateway({ routes });
  try {
    await run(g);
  } finally {
    await g.close();
  }
}

test.before(flakyListen);
test.after(() => flaky.close());

test('fallback: a 429 is served by the next provider, with its own model and key', async () => {
  mode = 'json';
  flakyStatus = 429;
  flakyHits = 0;
  captured = [];
  await withGateway([flakyRoute(), healthyRoute()], async (g) => {
    const res = await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g);
    assert.equal(res.status, 200);
    assert.equal(flakyHits, 1);
    assert.equal(captured[0]!.auth, 'Bearer sk-cerebras');
    assert.equal(captured[0]!.body.model, 'gpt-oss-120b');
    const msg = (await res.json()) as { model: string };
    assert.equal(msg.model, 'flaky/big'); // claude keeps seeing the model it asked for
    assert.deepEqual(g.fallbacks(), [{ from: 'Flaky', to: 'Cerebras', status: 429 }]);

    // Retry-After: 30 -> the primary is skipped while it cools down.
    const again = await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g);
    assert.equal(again.status, 200);
    assert.equal(flakyHits, 1);
  });
});

test('fallback: a 413 (request too big for the free tier) skips once, without cooldown', async () => {
  mode = 'json';
  flakyStatus = 413;
  flakyHits = 0;
  await withGateway([flakyRoute(), healthyRoute()], async (g) => {
    assert.equal((await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g)).status, 200);
    assert.equal((await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g)).status, 200);
    assert.equal(flakyHits, 2); // primary tried again: smaller requests may still fit
  });
});

test('fallback: a client error (400) is returned as is, never retried elsewhere', async () => {
  flakyStatus = 400;
  captured = [];
  await withGateway([flakyRoute(), healthyRoute()], async (g) => {
    const res = await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g);
    assert.equal(res.status, 400);
    assert.equal(captured.length, 0);
    assert.deepEqual(g.fallbacks(), []);
  });
});

test('fallback: every route out of quota -> the last real error reaches claude', async () => {
  flakyStatus = 429;
  await withGateway([flakyRoute(), { ...flakyRoute(), providerId: 'flaky2', providerName: 'Flaky 2' }], async (g) => {
    const res = await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g);
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'rate_limit_error');
  });
});

test('fallback: an unreachable provider falls back too', async () => {
  mode = 'json';
  const dead: GatewayRoute = { ...flakyRoute(), providerId: 'dead', api: { base_url: 'http://127.0.0.1:9', model_prefix: 'flaky/' } };
  await withGateway([dead, healthyRoute()], async (g) => {
    const res = await callGateway('/v1/messages', request({ model: 'flaky/big' }), undefined, g);
    assert.equal(res.status, 200);
    assert.equal(g.fallbacks()[0]!.status, 0);
  });
});

test('fallback: never switches once the stream has started', async () => {
  mode = 'abort';
  flakyHits = 0;
  await withGateway([healthyRoute(), flakyRoute()], async (g) => {
    const res = await callGateway('/v1/messages', request({ model: 'cerebras/gpt-oss-120b', stream: true }), undefined, g);
    const text = await res.text();
    assert.match(text, /event: error/);
    assert.equal(flakyHits, 0);
  });
  mode = 'json';
});
