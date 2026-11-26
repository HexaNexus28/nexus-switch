import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Provider } from '../types/provider.types.js';
import { t } from '../i18n/index.js';

interface Props {
  providers: Provider[];
  onSelect: (provider: Provider) => void;
  onReport: () => void;
  onQuit: () => void;
}

/** "8 models · free" / "9 models · free quota" — the cheapest tier available. */
function summary(p: Provider): string {
  const tiers = new Set(p.models.map((m) => m.tier));
  const best = tiers.has('free')
    ? t.providers.bestFree
    : tiers.has('quota')
      ? t.providers.bestQuota
      : tiers.has('paid')
        ? t.providers.bestPaid
        : t.providers.bestSubscription;
  return `${t.providers.models(p.models.length)} · ${best}${p.bare ? t.providers.reduced : ''}`;
}

export function ProviderList({ providers, onSelect, onReport, onQuit }: Props) {
  const [cursor, setCursor] = useState(0);
  const nameWidth = providers.length > 0 ? Math.max(...providers.map((p) => p.name.length)) : 0;

  useInput((input, key) => {
    if (providers.length === 0) {
      if (input === 'q' || key.escape || key.return) onQuit();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(providers.length - 1, c + 1));
    if (key.return) onSelect(providers[cursor]!);
    if (input === 'r') onReport();
    if (input === 'q' || key.escape) onQuit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="cyan" bold>
          Providers
        </Text>
        <Text dimColor>{t.providers.subtitle}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(72, nameWidth + 30))}</Text>
      {providers.length === 0 ? <Text color="red">{t.providers.none}</Text> : null}
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
        <Text dimColor>{t.providers.hint}</Text>
      </Box>
    </Box>
  );
}
