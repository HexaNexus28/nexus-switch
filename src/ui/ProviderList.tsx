import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Provider } from '../types/provider.types.js';

interface Props {
  providers: Provider[];
  onSelect: (provider: Provider) => void;
  onQuit: () => void;
}

/** "8 modeles · gratuit" / "9 modeles · quota" — the cheapest tier available. */
function summary(p: Provider): string {
  const tiers = new Set(p.models.map((m) => m.tier));
  const best = tiers.has('free') ? 'gratuit' : tiers.has('quota') ? 'quota gratuit' : tiers.has('paid') ? 'payant' : 'abonnement';
  return `${p.models.length} modeles · ${best}`;
}

export function ProviderList({ providers, onSelect, onQuit }: Props) {
  const [cursor, setCursor] = useState(0);
  const nameWidth = Math.max(...providers.map((p) => p.name.length));

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(providers.length - 1, c + 1));
    if (key.return) onSelect(providers[cursor]!);
    if (input === 'q' || key.escape) onQuit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="cyan" bold>
          Providers
        </Text>
        <Text dimColor>{'  ·  choisis ta source de modeles'}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(72, nameWidth + 30))}</Text>
      {providers.map((p, i) => {
        const selected = i === cursor;
        return (
          <Text key={p.name}>
            <Text color="cyan">{selected ? '▸ ' : '  '}</Text>
            <Text bold={selected} dimColor={!selected}>
              {p.name.padEnd(nameWidth + 2)}
            </Text>
            <Text dimColor>{summary(p)}</Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ naviguer · ⏎ choisir · q quitter'}</Text>
      </Box>
    </Box>
  );
}
