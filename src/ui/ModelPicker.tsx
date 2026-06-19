import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Provider, ProviderModel } from '../types/provider.types.js';

interface Props {
  provider: Provider;
  onSelect: (model: ProviderModel) => void;
  onBack: () => void;
}

export function ModelPicker({ provider, onSelect, onBack }: Props) {
  const [cursor, setCursor] = useState(0);
  const models = provider.models;

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
        <Text key={m.id} inverse={i === cursor} color={m.free ? 'green' : 'gray'}>
          {i === cursor ? '▶ ' : '  '}
          {m.name}
          {m.free ? ' · gratuit' : ''}
          {typeof m.ram_gb === 'number' ? ` · ${m.ram_gb} Go` : ''}
        </Text>
      ))}
      <Text color="gray">↑↓ naviguer · Entrée lancer · ← retour</Text>
    </Box>
  );
}
