import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../i18n/index.js';

interface Props {
  providerId: string;
  varName: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** In-Ink masked API-key input (stdin never leaves Ink; value goes to the store). */
export function KeyPrompt({ providerId, varName, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      else onCancel();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Paste arrives as one chunk; strip control chars, keep the rest.
    const clean = input.replace(/[\x00-\x1f\x7f]/g, '');
    if (clean) setValue((v) => v + clean);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="yellow" bold>
        {t.keyPrompt.title(providerId, varName)}
      </Text>
      <Text>{t.keyPrompt.body}</Text>
      <Box marginTop={1}>
        <Text color="cyan">{'▸ '}</Text>
        <Text>{value ? '•'.repeat(Math.min(value.length, 48)) : ''}</Text>
        <Text dimColor>{value ? `  (${value.length})` : t.keyPrompt.placeholder}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t.keyPrompt.hint}</Text>
      </Box>
    </Box>
  );
}
