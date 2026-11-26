import { Box, Text, useStdout } from 'ink';
import { availableUpdate, CURRENT_VERSION } from '../core/update.js';
import { t } from '../i18n/index.js';

const VERSION = CURRENT_VERSION ? `v${CURRENT_VERSION}` : '';

/**
 * One-line signature. The hub re-renders the TUI after every claude session, so
 * the header must stay cheap and flat — identity comes from the glyph +
 * wordmark, the rest is version info. (The old :4000 proxy indicator is gone:
 * the native gateway is an ephemeral in-process server bound only while claude
 * runs, so there is no long-lived state worth showing here.)
 */
export function Header() {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  // Manual spacing: Ink's justify depends on the parent width, which is not
  // guaranteed here — measure the plain strings and pad deterministically.
  const tagline = cols >= 72 ? '  ·  AI model router · HexaNexus' : '';
  const left = `◢ NEXUS SWITCH${tagline}`;
  const update = availableUpdate();
  const notice = update ? t.header.update(update) : '';
  const right = `${VERSION}${notice}`;
  const gap = Math.max(2, cols - 2 - left.length - right.length);

  return (
    <Box marginY={1} paddingX={1}>
      <Text>
        <Text color="cyan">{'◢ '}</Text>
        <Text bold>NEXUS SWITCH</Text>
        <Text dimColor>{tagline}</Text>
        {VERSION && cols >= 56 ? (
          <Text dimColor>{`${' '.repeat(gap)}${VERSION}`}</Text>
        ) : null}
        {notice && cols >= 56 ? <Text color="yellow">{notice}</Text> : null}
      </Text>
    </Box>
  );
}
