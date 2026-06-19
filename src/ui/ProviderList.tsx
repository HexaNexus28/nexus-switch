import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Provider } from '../types/provider.types.js';

interface Props {
  providers: Provider[];
  onSelect: (provider: Provider) => void;
  onQuit: () => void;
}

export function ProviderList({ providers, onSelect, onQuit }: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(providers.length - 1, c + 1));
    if (key.return) onSelect(providers[cursor]!);
    if (input === 'q' || key.escape) onQuit();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Provider
      </Text>
      {providers.map((p, i) => (
        <Text key={p.name} inverse={i === cursor}>
          {i === cursor ? '▶ ' : '  '}
          {p.name}
        </Text>
      ))}
      <Text color="gray">↑↓ naviguer · Entrée choisir · q quitter</Text>
    </Box>
  );
}
