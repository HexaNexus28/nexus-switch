// `nexus report` — turns "it doesn't work" into a reproducible bug report.
//
// Nothing is sent by nexus: it opens a pre-filled GitHub issue in the browser,
// the user reads it and decides to submit. No server, no telemetry, no data
// kept on our side. Every secret is masked before the text leaves this process.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import type { Diagnostic } from '../types/report.types.js';
import { locale, t } from '../i18n/index.js';
import { KEY_VARS, readKey } from './keys.js';
import { resolveClaude } from './launch.js';
import { PACKAGE } from './package-info.js';
import { nexusDataDir, secretStoreInfo } from './secrets.js';

const LOG_FILES = ['gateway.log', 'secrets-errors.log'] as const;
const LOG_TAIL_LINES = 20;
const PROBE_TIMEOUT_MS = 10_000;
/** GitHub rejects longer issue URLs; leave room for the template params. */
const MAX_URL_LENGTH = 7500;
const ISSUE_TEMPLATE = 'bug.yml';
const MASK = '[redacted]';

/** Key shapes of the supported providers + nexus' own session tokens. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/g, // OpenRouter, Anthropic, OpenAI-style
  /\bgsk_[A-Za-z0-9]{12,}/g, // Groq
  /\bAIza[A-Za-z0-9_-]{20,}/g, // Google / Gemini
  /\bnvapi-[A-Za-z0-9_-]{12,}/g, // NVIDIA
  /\bcsk-[A-Za-z0-9_-]{12,}/g, // Cerebras
  /\bnexus-session-[A-Za-z0-9-]+/g,
  /\b(Bearer|x-api-key:?)\s+\S+/gi,
];

/**
 * Mask every secret: the exact stored key values first (catches any format),
 * then known key shapes, then the home path (it carries the OS user name).
 */
export function redact(text: string, secrets: readonly string[], home: string = homedir()): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 8) out = out.split(secret).join(MASK);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, MASK);
  if (home) out = out.split(home).join('~');
  return out;
}

function probeVersion(file: string, args: string[]): string | null {
  const result = spawnSync(file, [...args, '--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').trim().split(/\r?\n/)[0] ?? null;
}

function claudeSummary(): string {
  const command = resolveClaude();
  if (!command) return 'not found on PATH';
  if (command.kind === 'cmd-shim') return 'npm .cmd shim (cmd.exe fallback)';
  const install = command.args.length > 0 ? 'npm (node + cli.js)' : 'native binary';
  return `${probeVersion(command.file, command.args) ?? 'version unknown'} · ${install}`;
}

function tail(file: string): string[] {
  const path = join(nexusDataDir(), file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-LOG_TAIL_LINES);
}

export function collectDiagnostic(): Diagnostic {
  const env = process.env;
  const keys: Record<string, boolean> = {};
  for (const [provider, varName] of Object.entries(KEY_VARS)) keys[provider] = Boolean(readKey(varName));
  const logs: Record<string, string[]> = {};
  for (const file of LOG_FILES) {
    const lines = tail(file);
    if (lines.length > 0) logs[file] = lines;
  }
  return {
    nexus: PACKAGE.version || 'unknown',
    node: process.version,
    os: `${platform()} ${release()} ${arch()}`,
    locale,
    shell: env.MSYSTEM ? `Git Bash (${env.MSYSTEM})` : (env.SHELL ?? env.ComSpec ?? 'unknown'),
    terminal: env.TERM_PROGRAM ?? (env.WT_SESSION ? 'Windows Terminal' : (env.TERM ?? 'unknown')),
    stdinTty: Boolean(process.stdin.isTTY),
    claude: claudeSummary(),
    ollama: probeVersion('ollama', []) ?? 'not installed',
    keys,
    store: secretStoreInfo(),
    logs,
  };
}

/** Markdown body for the issue's diagnostic field. */
export function formatDiagnostic(d: Diagnostic): string {
  const keys = Object.entries(d.keys)
    .map(([provider, present]) => `${provider}=${present ? 'yes' : 'no'}`)
    .join(' ');
  const store = d.store.exists
    ? `${d.store.enc}${d.store.corruptBackups ? ` · ${d.store.corruptBackups} corrupt backup(s)` : ''}`
    : 'none';
  const lines = [
    `nexus     ${d.nexus}`,
    `node      ${d.node}`,
    `os        ${d.os}`,
    `locale    ${d.locale}`,
    `shell     ${d.shell}`,
    `terminal  ${d.terminal} · stdin TTY=${d.stdinTty ? 'yes' : 'no'}`,
    `claude    ${d.claude}`,
    `ollama    ${d.ollama}`,
    `keys      ${keys}`,
    `store     ${store}`,
  ];
  for (const [file, content] of Object.entries(d.logs)) lines.push('', `--- ${file} (last ${content.length})`, ...content);
  return lines.join('\n');
}

/**
 * Pre-filled issue-form URL. The diagnostic is cut from the end when the URL
 * would exceed GitHub's limit (the full text is printed in the terminal anyway).
 */
export function issueUrl(bugsUrl: string, diagnostic: string): string {
  const build = (body: string) =>
    `${bugsUrl}/new?${new URLSearchParams({ template: ISSUE_TEMPLATE, diagnostic: body }).toString()}`;
  let body = diagnostic;
  let url = build(body);
  while (url.length > MAX_URL_LENGTH && body.length > 0) {
    body = body.slice(0, Math.floor(body.length * 0.8));
    url = build(`${body}\n[truncated — full report in the terminal]`);
  }
  return url;
}

/**
 * Open a URL in the default browser without going through a shell (the URL
 * holds `&`, which cmd.exe would split). Best effort: the caller always prints
 * the link too, for headless machines or a missing xdg-open.
 */
export function openInBrowser(url: string): void {
  const [file, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

/** `nexus report` / TUI `r`: print the redacted diagnostic, open the pre-filled issue. */
export function runReport(): void {
  const secrets = Object.values(KEY_VARS)
    .map((varName) => readKey(varName))
    .filter((value): value is string => Boolean(value));
  const text = redact(formatDiagnostic(collectDiagnostic()), secrets);
  const url = issueUrl(PACKAGE.bugsUrl, text);
  console.log(`${t.report.header}\n\n${text}\n`);
  console.log(t.report.opening);
  console.log(t.report.nothingSent);
  openInBrowser(url);
  console.log(`\n${t.report.link(url)}`);
}
