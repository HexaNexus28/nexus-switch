// Fallback chain: which providers the gateway may switch to when the one the
// user picked runs out of quota. Pure — catalog, keys and preferences are passed in.
//
// Rules (they carry the product promise "no surprise bills"):
//   - only gateway providers with a configured key;
//   - only a model of the SAME class as the picked one (large / fast);
//   - only FREE or QUOTA models — never PAID or UPGRADE;
//   - order: the user's manual chain if set, else each provider's fallback_order.

import type { GatewayRoute } from '../types/gateway.types.js';
import type { ModelTier, Provider } from '../types/provider.types.js';

const FALLBACK_TIERS: ReadonlySet<ModelTier> = new Set(['free', 'quota']);

/** The route for one provider + model, or null when it cannot be served by the gateway. */
export function routeFor(provider: Provider, model: string, apiKey: string | undefined): GatewayRoute | null {
  if (provider.type !== 'gateway' || !provider.api || !provider.id || !apiKey) return null;
  const entry = provider.models.find((m) => m.id === model);
  return {
    providerId: provider.id,
    providerName: provider.name,
    api: provider.api,
    apiKey,
    model,
    ...(provider.max_request_tokens !== undefined ? { maxRequestTokens: provider.max_request_tokens } : {}),
    ...(entry?.context ? { context: entry.context } : {}),
  };
}

/** Providers eligible as fallbacks, in try order. */
function fallbackPool(all: readonly Provider[], manualChain: readonly string[] | undefined): Provider[] {
  if (manualChain && manualChain.length > 0) {
    return manualChain
      .map((id) => all.find((p) => p.id === id))
      .filter((p): p is Provider => p !== undefined);
  }
  return all
    .filter((p) => p.fallback_order !== undefined)
    .sort((a, b) => (a.fallback_order ?? 0) - (b.fallback_order ?? 0));
}

/**
 * routes[0] = the picked provider/model; the rest = fallbacks. Returns only the
 * primary when the picked model has no class (nothing known to be equivalent).
 */
export function buildRoutes(
  primary: Provider,
  model: string,
  all: readonly Provider[],
  keyFor: (providerId: string) => string | undefined,
  manualChain?: readonly string[],
): GatewayRoute[] {
  const first = routeFor(primary, model, primary.id ? keyFor(primary.id) : undefined);
  if (!first) return [];
  const modelClass = primary.models.find((m) => m.id === model)?.class;
  if (!modelClass) return [first];
  const fallbacks = fallbackPool(all, manualChain)
    .filter((p) => p.id !== primary.id)
    .map((p) => {
      const eligible = p.models.filter((m) => m.class === modelClass && FALLBACK_TIERS.has(m.tier));
      // The provider's default is its best-known model (Gemini: 2.5 Flash, not
      // the tiny-quota 2.5 Pro listed first); else the first eligible in catalog order.
      const match = eligible.find((m) => m.id === p.default) ?? eligible[0];
      return match && p.id ? routeFor(p, match.id, keyFor(p.id)) : null;
    })
    .filter((r): r is GatewayRoute => r !== null);
  return [first, ...fallbacks];
}
