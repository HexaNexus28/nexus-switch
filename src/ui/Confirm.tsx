import { Box, Text, useInput } from 'ink';

interface Props {
  title: string;
  message: string;
  /** Shown dim under the question (e.g. the exact command that will run). */
  command?: string;
  onAnswer: (yes: boolean) => void;
}

/** In-Ink [o/N] dialog — stdin never leaves Ink, unlike a readline prompt. */
export function Confirm({ title, message, command, onAnswer }: Props) {
  useInput((input, key) => {
    if (/^[oy]$/i.test(input)) onAnswer(true);
    else if (/^n$/i.test(input) || key.escape || key.return) onAnswer(false);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      <Text>{message}</Text>
      {command ? <Text dimColor>{`  $ ${command}`}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>{'o = oui · n / Entree / Esc = non'}</Text>
      </Box>
    </Box>
  );
}
