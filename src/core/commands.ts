// CLI command registry, help text and "did you mean" — pure, no I/O.
//
// The registry is the single list the dispatcher, the help screen and the typo
// suggestions all read, so a new command cannot be reachable yet missing from
// `nexus help` (covered by commands.test.ts).

import type { Messages } from '../i18n/en.js';

export const COMMANDS = [
  'doctor',
  'credits',
  'chain',
  'report',
  'refresh',
  'key',
  'update',
  'uninstall',
  'help',
  'version',
] as const;
export type CommandName = (typeof COMMANDS)[number];

/** Conventional flags that stand for a command. */
export const COMMAND_FLAGS: Readonly<Record<string, CommandName>> = {
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
};

export function resolveCommand(arg: string): CommandName | undefined {
  return (COMMANDS as readonly string[]).includes(arg) ? (arg as CommandName) : COMMAND_FLAGS[arg];
}

const MIN_PREFIX = 3;
const SHORT_WORD = 4;

function distance(a: string, b: string): number {
  // Levenshtein with adjacent transpositions ("gemnii" -> "gemini" costs 1).
  const cols = b.length + 1;
  const d = new Array<number>((a.length + 1) * cols).fill(0);
  const at = (i: number, j: number): number => d[i * cols + j] ?? 0;
  for (let i = 0; i <= a.length; i++) d[i * cols] = i;
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      d[i * cols + j] = best;
    }
  }
  return at(a.length, b.length);
}

/**
 * The candidate the user most likely meant, or undefined when nothing is close
 * enough to be a typo: a unique prefix ("doc" -> doctor), otherwise the nearest
 * word within 1 edit for short inputs and 2 for longer ones.
 */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  const word = input.toLowerCase();
  if (!word) return undefined;
  const prefixed = candidates.filter((c) => c.startsWith(word));
  if (word.length >= MIN_PREFIX && prefixed.length === 1) return prefixed[0];
  const maxEdits = word.length <= SHORT_WORD ? 1 : 2;
  let best: { candidate: string; edits: number } | undefined;
  for (const candidate of candidates) {
    const edits = distance(word, candidate);
    if (edits <= maxEdits && (!best || edits < best.edits)) best = { candidate, edits };
  }
  return best?.candidate;
}

export function renderHelp(m: Messages, providers: readonly string[], version: string): string {
  const h = m.help;
  const rows: Array<[string, string]> = [
    ['nexus', h.tui],
    ['nexus <provider> [model] [-- claude flags]', h.launch],
    ['nexus doctor', h.doctor],
    ['nexus credits', h.credits],
    ['nexus chain [auto | set <provider>... | off]', h.chain],
    ['nexus report', h.report],
    ['nexus refresh', h.refresh],
    ['nexus key set <provider> <key>', h.keySet],
    ['nexus key list', h.keyList],
    ['nexus key delete <provider>', h.keyDelete],
    ['nexus update', h.update],
    ['nexus uninstall', h.uninstall],
    ['nexus help    (-h, --help)', h.help],
    ['nexus version (-v, --version)', h.version],
  ];
  const env: Array<[string, string]> = [
    ['NEXUS_LANG=en|fr', h.envLang],
    ['NEXUS_NO_FALLBACK=1', h.envNoFallback],
    ['NEXUS_FULL_PROMPT=1', h.envFullPrompt],
    ['NEXUS_NO_UPDATE_CHECK=1', h.envNoUpdateCheck],
  ];
  const width = Math.max(...[...rows, ...env].map(([left]) => left.length)) + 2;
  const table = (list: Array<[string, string]>) => list.map(([left, text]) => `  ${left.padEnd(width)}${text}`);
  return [
    `Nexus Switch ${version}`.trim(),
    '',
    h.usage,
    ...table(rows),
    '',
    h.providers(providers.join(', ')),
    '',
    h.environment,
    ...table(env),
    '',
    h.docs,
  ].join('\n');
}
