// Native gateway — in-process loopback HTTP server replacing the LiteLLM proxy.
//
// Lifecycle: started by launch() right before spawning claude, closed when
// claude exits. Ephemeral port (no collision between concurrent sessions, no
// "is the old proxy stale" bookkeeping) + per-session bearer token (nothing
// persisted, nothing shared). The provider API key stays inside this process;
// it is never exported to the environment.
//
// Silence is deliberate: claude draws its TUI on the same terminal this
// process owns, so the gateway never writes to stdout/stderr while serving.
// Set NEXUS_GATEWAY_DEBUG=1 to append request traces to ~/.nexus-switch/gateway.log.

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AnthropicMessagesRequest, FallbackEvent, GatewayRoute, OpenAIChatResponse } from '../types/gateway.types.js';
import { nexusDataDir } from '../core/secrets.js';
import { candidates, cooldownMs, NETWORK_ERROR, routeKey, shouldFallback } from './router.js';
import { createSseParser, createStreamTranslator } from './stream.js';
import { estimateTokens, translateRequest, translateResponse } from './translate.js';
import { t } from '../i18n/index.js';

const LOOPBACK = '127.0.0.1';

export interface GatewayOptions {
  /** routes[0] is the provider the user picked; the rest is the fallback chain, in order. */
  routes: GatewayRoute[];
}

/** Session state shared by every request: cooldowns and the fallbacks that happened. */
interface SessionState {
  cooldownUntil: Map<string, number>;
  fallbacks: FallbackEvent[];
}

export interface RunningGateway {
  /** Ephemeral port actually bound. */
  port: number;
  /** http://127.0.0.1:<port> — what ANTHROPIC_BASE_URL must point to. */
  baseUrl: string;
  /** Per-session bearer token — what ANTHROPIC_AUTH_TOKEN must carry. */
  token: string;
  /** Requests served by a fallback during this session (for the post-session summary). */
  fallbacks(): readonly FallbackEvent[];
  close(): Promise<void>;
}

function debugLog(line: string): void {
  if (process.env.NEXUS_GATEWAY_DEBUG !== '1') return;
  try {
    appendFileSync(join(nexusDataDir(), 'gateway.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* debug only — never disturb the session */
  }
}

/** Upstream HTTP status -> Anthropic error type (what Claude Code knows to render/retry). */
function errorType(status: number): string {
  switch (status) {
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 429: return 'rate_limit_error';
    case 503:
    case 529: return 'overloaded_error';
    default: return 'api_error';
  }
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: errorType(status), message } }));
}

/**
 * SSE errors happen after the 200 header is on the wire. Emitting an Anthropic
 * `error` event lets Claude Code retry; closing with message_stop would instead
 * present a truncated answer as a complete success.
 */
function sendStreamError(res: ServerResponse, message: string): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`);
  res.end();
}

/** Pull the human-readable message out of an OpenAI-shaped error body, else raw text. */
function upstreamErrorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    /* not JSON */
  }
  return bodyText.slice(0, 2000);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorized(req: IncomingMessage, token: string): boolean {
  const bearer = req.headers.authorization;
  if (bearer === `Bearer ${token}`) return true;
  return req.headers['x-api-key'] === token;
}

/** Catalog ids are provider-prefixed (groq/..., nvidia_nim/...); upstream wants the bare id. */
function upstreamModel(model: string, prefix: string): string {
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/** Last upstream failure, answered to claude when every route failed. */
interface Failure {
  status: number;
  message: string;
}

function sendFailure(res: ServerResponse, failure: Failure): void {
  if (failure.status === 413) {
    // Claude Code renders any 413 as its own "max 32MB / images" message and
    // drops ours. A provider 413 is a token quota (Groq free tier: 8000 TPM vs
    // ~24k for a full Claude Code prompt): retrying never helps, so answer 400.
    sendError(res, 400, `${failure.message}\n${t.gateway.quotaHint}`);
    return;
  }
  sendError(res, failure.status === NETWORK_ERROR ? 502 : failure.status, failure.message);
}

/**
 * Try the routes in order until one answers. Switching is only possible
 * BEFORE the response starts: once the 200 header and first SSE bytes are on
 * the wire, a failure is reported as a stream error, never replayed elsewhere.
 */
async function handleMessages(
  body: AnthropicMessagesRequest,
  options: GatewayOptions,
  session: SessionState,
  res: ServerResponse,
  clientGone: AbortSignal,
): Promise<void> {
  const [primary] = options.routes;
  const tried = candidates(options.routes, session.cooldownUntil, Date.now(), estimateTokens(body));
  let failure: Failure | null = null;
  let failedRoute: GatewayRoute | null = null;
  for (const route of tried) {
    // The primary serves whatever model claude asked for; a fallback serves its own.
    const model = route === primary ? body.model : route.model;
    const { request, dropped } = translateRequest(body, upstreamModel(model, route.api.model_prefix));
    if (dropped.length > 0) debugLog(`dropped fields: ${dropped.join(', ')}`);
    let upstream: Response;
    try {
      upstream = await fetch(`${route.api.base_url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${route.apiKey}` },
        body: JSON.stringify(request),
        signal: clientGone,
      });
    } catch (err) {
      if (clientGone.aborted) return; // client cancelled; nothing to answer
      const reason = err instanceof Error ? err.message : String(err);
      debugLog(`${route.providerId} unreachable: ${reason}`);
      session.cooldownUntil.set(routeKey(route), Date.now() + cooldownMs(NETWORK_ERROR, null, Date.now()));
      failure = { status: NETWORK_ERROR, message: t.gateway.providerUnreachable(route.api.base_url, reason) };
      failedRoute ??= route;
      continue;
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      debugLog(`${route.providerId} upstream ${upstream.status}: ${text.slice(0, 500)}`);
      failure = { status: upstream.status, message: upstreamErrorMessage(text) };
      if (!shouldFallback(upstream.status)) break; // a bad request fails everywhere
      const pause = cooldownMs(upstream.status, upstream.headers.get('retry-after'), Date.now());
      if (pause > 0) session.cooldownUntil.set(routeKey(route), Date.now() + pause);
      failedRoute ??= route;
      continue;
    }
    if (failedRoute && failure) {
      session.fallbacks.push({ from: failedRoute.providerName, to: route.providerName, status: failure.status });
      debugLog(`fallback ${failedRoute.providerId} -> ${route.providerId} (${failure.status})`);
    }
    await serveResponse(upstream, request.stream === true, body.model, res, clientGone);
    return;
  }
  if (failure) sendFailure(res, failure);
}

/** Relay a successful upstream answer to claude, translated to Anthropic's shape. */
async function serveResponse(
  upstream: Response,
  stream: boolean,
  requestedModel: string,
  res: ServerResponse,
  clientGone: AbortSignal,
): Promise<void> {
  if (!stream) {
    const json = (await upstream.json()) as OpenAIChatResponse;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(translateResponse(json, requestedModel)));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const translator = createStreamTranslator(requestedModel);
  const parser = createSseParser();
  const reader = upstream.body?.getReader();
  if (!reader) {
    sendStreamError(res, 'Upstream returned no stream body.');
    return;
  }
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const chunk of parser.feed(decoder.decode(value, { stream: true }))) {
        res.write(translator.push(chunk));
      }
    }
    // Flush both buffers: a multi-byte character can be split across the last
    // read, and some providers omit the blank line after the final SSE event.
    for (const chunk of parser.feed(decoder.decode())) res.write(translator.push(chunk));
    for (const chunk of parser.flush()) res.write(translator.push(chunk));
    res.end(translator.end());
  } catch (err) {
    if (clientGone.aborted) return; // client cancelled; nothing to answer
    debugLog(`stream interrupted: ${err instanceof Error ? err.message : String(err)}`);
    sendStreamError(res, 'Upstream stream interrupted.');
  }
}

export function startGateway(options: GatewayOptions): Promise<RunningGateway> {
  const token = `nexus-session-${randomUUID()}`;
  const session: SessionState = { cooldownUntil: new Map(), fallbacks: [] };
  const server: Server = createServer((req, res) => {
    void (async () => {
      debugLog(`${req.method} ${req.url}`);
      if (!authorized(req, token)) {
        debugLog('rejected: session token mismatch');
        sendError(res, 401, 'Invalid gateway session token.');
        return;
      }
      if (req.method !== 'POST') {
        sendError(res, 404, `No such endpoint: ${req.method} ${req.url}`);
        return;
      }
      const url = (req.url ?? '').split('?')[0];
      let body: AnthropicMessagesRequest;
      try {
        body = JSON.parse(await readBody(req)) as AnthropicMessagesRequest;
      } catch {
        sendError(res, 400, 'Request body is not valid JSON.');
        return;
      }
      if (url === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: estimateTokens(body) }));
        return;
      }
      if (url === '/v1/messages') {
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        await handleMessages(body, options, session, res, abort.signal);
        return;
      }
      sendError(res, 404, `No such endpoint: POST ${url}`);
    })().catch((err: unknown) => {
      debugLog(`handler error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendError(res, 500, 'Gateway internal error.');
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Gateway bound to a non-TCP address.'));
        return;
      }
      resolve({
        port: address.port,
        baseUrl: `http://${LOOPBACK}:${address.port}`,
        token,
        fallbacks: () => session.fallbacks,
        close: () =>
          new Promise<void>((done) => {
            // closeAllConnections: an open SSE stream would otherwise hold
            // close() forever after claude exits.
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
