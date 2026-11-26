import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ModelTier, Provider, ProviderModel } from '../types/provider.types.js';
import { t } from '../i18n/index.js';

interface Props {
  provider: Provider;
  onSelect: (model: ProviderModel) => void;
  onBack: () => void;
}

/** Cheapest-first: what a fresh user wants to reach without reading anything. */
const TIER_ORDER: Record<ModelTier, number> = { free: 0, quota: 1, paid: 2, subscription: 3 };

const TIER_COLOR: Record<ModelTier, string> = {
  free: 'green',
  quota: 'yellow',
  paid: 'red',
  subscription: 'magenta',
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
 * One plain sentence answering "what happens to my wallet if I pick
 * this?" — written for someone who knows nothing about the provider. Shown for
 * the highlighted model, so the row badges stay compact.
 */
function costSentence(m: ProviderModel): string {
  const account = m.signin_required ? t.picker.accountNamed(m.signin_required) : t.picker.accountGeneric;
  const price =
    typeof m.price_in === 'number' && m.price_in > 0 ? t.picker.pricePerMillion(m.price_in, m.price_out ?? '?') : null;
  switch (m.tier) {
    case 'free':
      return t.picker.costFree;
    case 'quota':
      return t.picker.costQuota(account, price ?? t.picker.quotaBeyondDefault);
    case 'paid':
      return t.picker.costPaid(price ?? t.picker.paidDefault);
    case 'subscription':
      return t.picker.costSubscription;
  }
}

/** Where the code goes: local models never leave the machine; cloud ones follow the provider's terms. */
function dataLine(provider: Provider, m: ProviderModel): string {
  if (m.location === 'local') return t.picker.dataLocal;
  return provider.data_policy ? t.picker.data(provider.data_policy.summary) : t.picker.dataUnknown;
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
        <Text dimColor>{`  ·  ${t.providers.models(models.length)}`}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(72, nameWidth + 40))}</Text>
      {models.map((m, i) => {
        const color = TIER_COLOR[m.tier];
        const selected = i === cursor;
        return (
          <Text key={m.id}>
            <Text color="cyan">{selected ? '▸ ' : '  '}</Text>
            <Text color={color}>{'● '}</Text>
            <Text color={color} dimColor={!selected}>
              {t.picker.badge[m.tier].padEnd(8)}
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
          <Text color={current ? TIER_COLOR[current.tier] : 'gray'}>{'▍ '}</Text>
          {current ? costSentence(current) : ''}
        </Text>
        {current?.note ? <Text dimColor>{`  ${current.note}`}</Text> : null}
        {current ? <Text dimColor>{`  ${dataLine(provider, current)}`}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t.picker.hint}</Text>
      </Box>
    </Box>
  );
}
