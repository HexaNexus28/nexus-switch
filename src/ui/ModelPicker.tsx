import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ModelTier, Provider, ProviderModel } from '../types/provider.types.js';

interface Props {
  provider: Provider;
  onSelect: (model: ProviderModel) => void;
  onBack: () => void;
}

/** Cheapest-first: what a fresh user wants to reach without reading anything. */
const TIER_ORDER: Record<ModelTier, number> = { free: 0, quota: 1, paid: 2, subscription: 3 };

const TIER_BADGE: Record<ModelTier, { label: string; color: string }> = {
  free: { label: 'GRATUIT', color: 'green' },
  quota: { label: 'QUOTA', color: 'yellow' },
  paid: { label: 'PAYANT', color: 'red' },
  subscription: { label: 'UPGRADE', color: 'magenta' },
};

/** Context window as a compact label: 1000000 -> "1M", 256000 -> "256K". */
function fmtContext(c?: number | null): string {
  if (!c) return '';
  if (c >= 1_000_000) return `${Math.round(c / 100_000) / 10}M`.replace('.0M', 'M');
  if (c >= 1000) return `${Math.round(c / 1000)}K`;
  return String(c);
}

/** Compact right-side metadata: place · context · footprint or price. */
function fmtMeta(m: ProviderModel): string {
  const parts: string[] = [m.location];
  const ctx = fmtContext(m.context);
  if (ctx) parts.push(ctx);
  if (m.location === 'local' && typeof m.ram_gb === 'number') parts.push(`${m.ram_gb}GB RAM`);
  if (typeof m.price_in === 'number' && m.price_in > 0) parts.push(`$${m.price_in}/${m.price_out ?? '?'}`);
  return parts.join(' · ');
}

/**
 * One plain-French sentence answering "what happens to my wallet if I pick
 * this?" — written for someone who knows nothing about the provider. Shown for
 * the highlighted model, so the row badges stay compact.
 */
function costSentence(m: ProviderModel): string {
  const account = m.signin_required ? `compte ${m.signin_required} gratuit requis` : 'compte gratuit requis';
  const price =
    typeof m.price_in === 'number' && m.price_in > 0
      ? `$${m.price_in} in / $${m.price_out ?? '?'} out par M tokens`
      : null;
  switch (m.tier) {
    case 'free':
      return 'Gratuit — tourne sur ta machine, aucun compte, aucune facturation.';
    case 'quota':
      return `Gratuit jusqu'au quota (${account}) — au-dela : ${price ?? 'bloque jusqu\'au reset, ou plan payant'}.`;
    case 'paid':
      return `Payant des la premiere requete — ${price ?? 'voir la grille du provider'}.`;
    case 'subscription':
      return 'Abonnement payant OBLIGATOIRE avant usage — ne fonctionne pas avec un compte gratuit.';
  }
}

export function ModelPicker({ provider, onSelect, onBack }: Props) {
  const [cursor, setCursor] = useState(0);
  const models = [...provider.models].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const nameWidth = Math.max(...models.map((m) => m.name.length));
  const current = models[cursor];

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(models.length - 1, c + 1));
    if (key.return) onSelect(models[cursor]!);
    if (input === 'q' || key.escape || key.leftArrow) onBack();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="cyan" bold>
          {provider.name}
        </Text>
        <Text dimColor>{`  ·  ${models.length} modeles`}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(72, nameWidth + 40))}</Text>
      {models.map((m, i) => {
        const badge = TIER_BADGE[m.tier];
        const selected = i === cursor;
        return (
          <Text key={m.id}>
            <Text color="cyan">{selected ? '▸ ' : '  '}</Text>
            <Text color={badge.color}>{'● '}</Text>
            <Text color={badge.color} dimColor={!selected}>
              {badge.label.padEnd(8)}
            </Text>
            <Text bold={selected} dimColor={!selected}>
              {m.name.padEnd(nameWidth + 2)}
            </Text>
            <Text dimColor>{fmtMeta(m)}</Text>
          </Text>
        );
      })}
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color={current ? TIER_BADGE[current.tier].color : 'gray'}>{'▍ '}</Text>
          {current ? costSentence(current) : ''}
        </Text>
        {current?.note ? <Text dimColor>{`  ${current.note}`}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ naviguer · ⏎ lancer · ← providers · q quitter'}</Text>
      </Box>
    </Box>
  );
}
