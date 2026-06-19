import { Box, Text, useStdout } from 'ink';

const H20 = '─'.repeat(20);
const H16 = '─'.repeat(16);
const H3 = '─'.repeat(3);

/**
 * Nexus logo: two interlaced rounded rectangles crossing on NEXUS / SWITCH with
 * diagonal nodes. Centred on the console width, simple fallback when narrow.
 * Ported from the PowerShell _ui_header.
 */
export function Header() {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  if (cols < 46) {
    return (
      <Box marginY={1}>
        <Text color="cyan" bold>
          {' '}
          N E X U S S W I T C H{' '}
        </Text>
        <Text color="gray"> · HexaNexus</Text>
      </Box>
    );
  }

  const pad = ' '.repeat(Math.max(2, Math.floor((cols - 38) / 2)));
  const p = (n: number): string => pad + ' '.repeat(n);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        {p(10)}
        <Text color="cyan">╭{H20}╮</Text>
      </Text>
      <Text>
        {p(10)}
        <Text color="cyan">│</Text>
        <Text color="white" bold>
          {'   N E X U S        '}
        </Text>
        <Text color="cyan">├─</Text>
        <Text color="green">●</Text>
      </Text>
      <Text>
        {p(6)}
        <Text color="cyan">╭{H3}</Text>
        <Text color="magenta">┼</Text>
        <Text color="cyan">{H16}╮</Text>
        {'   '}
        <Text color="cyan">├─</Text>
        <Text color="green">●</Text>
      </Text>
      <Text>
        {p(4)}
        <Text color="green">●</Text>
        <Text color="cyan">─┤</Text>
        {'   '}
        <Text color="cyan">╰{H16}</Text>
        <Text color="magenta">┼</Text>
        <Text color="cyan">{H3}╯</Text>
      </Text>
      <Text>
        {p(4)}
        <Text color="green">●</Text>
        <Text color="cyan">─┤</Text>
        <Text color="white" bold>
          {'    S W I T C H     '}
        </Text>
        <Text color="cyan">│</Text>
      </Text>
      <Text>
        {p(6)}
        <Text color="cyan">╰{H20}╯</Text>
      </Text>
      <Text>
        {p(6)}
        <Text color="cyan" bold>
          HexaNexus
        </Text>
        <Text color="gray">{'  ·  AI Model Router'}</Text>
      </Text>
    </Box>
  );
}
