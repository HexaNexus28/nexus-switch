import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { proxyRunning } from '../core/proxy.js';

// dist/ui/Header.js -> ../../package.json (same layout in the published package).
const VERSION: string = (() => {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return `v${(JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version}`;
  } catch {
    return '';
  }
})();

/**
 * One-line signature + live status. The hub re-renders the TUI after every
 * claude session, so the header must stay cheap and flat — identity comes from
 * the glyph + wordmark, the rest of the line is USEFUL state (version, LiteLLM
 * gateway reachability), not decoration.
 */
export function Header() {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const [proxyUp, setProxyUp] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void proxyRunning().then((up) => {
      if (alive) setProxyUp(up);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Manual spacing: Ink's justify depends on the parent width, which is not
  // guaranteed here — measure the plain strings and pad deterministically.
  const tagline = cols >= 72 ? '  ·  AI model router · HexaNexus' : '';
  const left = `◢ NEXUS SWITCH${tagline}`;
  const right = `${VERSION ? `${VERSION} · ` : ''}proxy ${proxyUp ? '● :4000' : '○'}`;
  const gap = Math.max(2, cols - 2 - left.length - right.length);

  return (
    <Box marginY={1} paddingX={1}>
      <Text>
        <Text color="cyan">{'◢ '}</Text>
        <Text bold>NEXUS SWITCH</Text>
        <Text dimColor>{tagline}</Text>
        {cols >= 56 ? (
          <>
            <Text dimColor>{`${' '.repeat(gap)}${VERSION ? `${VERSION} · ` : ''}proxy `}</Text>
            <Text color={proxyUp ? 'green' : 'gray'}>{proxyUp ? '●' : '○'}</Text>
            <Text dimColor>{proxyUp ? ' :4000' : ''}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}
