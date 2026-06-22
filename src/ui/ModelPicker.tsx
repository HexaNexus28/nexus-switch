import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Provider, ProviderModel } from '../types/provider.types.js';

interface Props {
  provider: Provider;
  onSelect: (model: ProviderModel) => void;
  onBack: () => void;
}

/** Context window as a compact label: 1000000 -> "1M", 256000 -> "256K". */
function fmtContext(c?: number | null): string {
  if (!c) return '';
  if (c >= 1_000_000) return `${Math.round(c / 100_000) / 10}M`.replace('.0M', 'M');
  if (c >= 1000) return `${Math.round(c / 1000)}K`;
  return String(c);
}

/** Memory column: local -> "RAM/disk GB"; paid cloud -> "$in/out"; free cloud -> "". */
function fmtSpec(m: ProviderModel): string {
  if (m.location === 'local') {
    const ram = typeof m.ram_gb === 'number' ? String(m.ram_gb) : '?';
    const disk = typeof m.disk_gb === 'number' ? String(m.disk_gb) : '?';
    return `${ram}/${disk}GB`;
  }
  if (typeof m.price_in === 'number' && m.price_in > 0) {
    return `$${m.price_in}/${m.price_out ?? '?'}`;
  }
  return '';
}

export function ModelPicker({ provider, onSelect, onBack }: Props) {
  const [cursor, setCursor] = useState(0);
  // Free models first — the ones the user actually wants to reach quickly.
  const models = [...provider.models].sort((a, b) => Number(b.free) - Number(a.free));

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(models.length - 1, c + 1));
    if (key.return) onSelect(models[cursor]!);
    if (input === 'q' || key.escape || key.leftArrow) onBack();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        {provider.name}
      </Text>
      {models.map((m, i) => (
        <Text key={m.id} inverse={i === cursor}>
          {i === cursor ? '▶ ' : '  '}
          <Text color={m.free ? 'green' : 'gray'}>{m.free ? 'GRATUIT' : 'PAYANT '}</Text>
          {'  '}
          <Text color={m.location === 'local' ? 'yellow' : 'blue'}>{m.location.padEnd(5)}</Text>
          {'  '}
          <Text color="gray">{fmtContext(m.context).padEnd(5)}</Text>
          {'  '}
          <Text color="gray">{fmtSpec(m).padEnd(9)}</Text>
          {'  '}
          {m.name}
        </Text>
      ))}
      <Text color="gray">{models[cursor]?.note ?? ''}</Text>
      <Text color="gray">local = RAM/disque · cloud payant = $in/out par M tokens</Text>
      <Text color="gray">↑↓ naviguer · Entrée lancer · ← retour</Text>
    </Box>
  );
}
