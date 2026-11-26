// Fallback routing decisions — pure functions, no I/O.
//
// The gateway tries its routes in order: the provider the user picked first,
// then the fallback chain. A route that answers 429/5xx is put on cooldown for
// the rest of its Retry-After window, so the next requests go straight to the
// next route and come back to the primary once the window is over.

import type { GatewayRoute } from '../types/gateway.types.js';

/** Upstream statuses worth retrying on another provider: quota, overload, outage. */
const FALLBACK_STATUSES: ReadonlySet<number> = new Set([413, 429, 502, 503, 504, 529]);
/** Pseudo-status for "provider unreachable" (DNS, refused, reset). */
export const NETWORK_ERROR = 0;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;
const MS_PER_SECOND = 1000;

export function shouldFallback(status: number): boolean {
  return status === NETWORK_ERROR || FALLBACK_STATUSES.has(status);
}

/**
 * How long to keep a failing route aside. 413 is "this request is too big for
 * the free tier", not "the provider is out": smaller requests still fit, so no
 * cooldown. Otherwise honour Retry-After (seconds or HTTP date), capped.
 */
export function cooldownMs(status: number, retryAfter: string | null, now: number): number {
  if (status === 413) return 0;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * MS_PER_SECOND : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_COOLDOWN_MS);
  }
  return DEFAULT_COOLDOWN_MS;
}

export function routeKey(route: GatewayRoute): string {
  return `${route.providerId}:${route.model}`;
}

/**
 * Routes to try for one request, in order. Fallbacks that are cooling down or
 * too small for the request (free-tier TPM, context window) are skipped. The
 * primary is only skipped while cooling down — and if every route is cooling
 * down, the primary is tried anyway so the user gets the provider's real answer.
 */
export function candidates(
  routes: readonly GatewayRoute[],
  cooldownUntil: ReadonlyMap<string, number>,
  now: number,
  estimatedTokens: number,
): GatewayRoute[] {
  const [primary, ...fallbacks] = routes;
  if (!primary) return [];
  const warm = (r: GatewayRoute) => (cooldownUntil.get(routeKey(r)) ?? 0) <= now;
  const fits = (r: GatewayRoute) =>
    (r.maxRequestTokens === undefined || estimatedTokens <= r.maxRequestTokens) &&
    (r.context === undefined || estimatedTokens <= r.context);
  const list = [...(warm(primary) ? [primary] : []), ...fallbacks.filter((r) => warm(r) && fits(r))];
  return list.length > 0 ? list : [primary];
}
