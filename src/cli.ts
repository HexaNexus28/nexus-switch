import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { refreshOpenRouter } from './core/catalog.js';
import { runDoctor } from './core/doctor.js';
import { KEY_VARS, keyVarFor, readKey } from './core/keys.js';
import { claudeExists, launch } from './core/launch.js';
import { listProviders, loadProvider } from './core/providers.js';
import { persistKey } from './platform/persist.js';

function mark(ok: boolean): string {
  return ok ? 'OK' : 'KO';
}

async function ensureClaude(): Promise<boolean> {
  if (claudeExists()) return true;
  console.error('Claude Code CLI absent. Nexus lance Claude Code, ce n’est pas un agent autonome.');
  if (!process.stdin.isTTY) {
    console.error('Install : npm i -g @anthropic-ai/claude-code');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Installer maintenant via npm ? [o/N] ')).trim();
  rl.close();
  if (!/^[oy]/i.test(answer)) {
    console.error('Abandon. Install manuelle : npm i -g @anthropic-ai/claude-code');
    return false;
  }
  spawnSync('npm', ['i', '-g', '@anthropic-ai/claude-code'], { stdio: 'inherit' });
  return claudeExists();
}

async function cmdDoctor(): Promise<void> {
  const report = await runDoctor();
  const claudeNote = report.claude ? '' : '  -> npm i -g @anthropic-ai/claude-code';
  console.log(`${mark(report.claude)}  Claude Code CLI${claudeNote}`);
  for (const k of report.keys) {
    const status = !k.present ? '..' : k.valid === false ? 'KO' : 'OK';
    const note = k.valid === true ? 'valide' : k.valid === false ? 'cle rejetee' : k.present ? 'presente' : 'absente';
    console.log(`${status}  ${k.provider.padEnd(10)} ${k.varName.padEnd(20)} ${note}`);
  }
}

async function cmdRefresh(): Promise<void> {
  const { kept, removed } = await refreshOpenRouter();
  const tail = removed.length ? ` : ${removed.join(', ')}` : '';
  console.log(`OpenRouter: ${kept} modeles conserves, ${removed.length} retires${tail}`);
}

function cmdKey(args: string[]): void {
  const [sub, provider, value] = args;
  if (sub === 'list') {
    for (const [p, varName] of Object.entries(KEY_VARS)) {
      const present = Boolean(readKey(varName));
      console.log(`${present ? 'OK' : '..'}  ${p.padEnd(10)} ${varName}`);
    }
    return;
  }
  if (sub === 'set' && provider && value) {
    const varName = keyVarFor(provider);
    if (!varName) {
      console.error(`Provider non supporte : ${provider}`);
      process.exitCode = 1;
      return;
    }
    persistKey(varName, value);
    console.log(`${varName} enregistree (persistante).`);
    return;
  }
  console.error('Usage: nexus key set <provider> <key>  |  nexus key list');
  process.exitCode = 1;
}

async function cmdLaunch(name: string, rest: string[]): Promise<void> {
  if (!listProviders().includes(name)) {
    console.error(`Provider inconnu : ${name}. Disponibles : ${listProviders().join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!(await ensureClaude())) {
    process.exitCode = 1;
    return;
  }
  const provider = loadProvider(name);
  const hasModel = Boolean(rest[0]) && !rest[0]!.startsWith('-');
  const model = hasModel ? rest[0]! : provider.default;
  const passthrough = hasModel ? rest.slice(1) : rest;
  launch(provider, model, passthrough);
}

function cmdHelp(): void {
  console.log(
    [
      'Nexus Switch',
      '',
      'Usage:',
      '  nexus <provider> [model] [-- claude flags]',
      '  nexus doctor',
      '  nexus refresh',
      '  nexus key set <provider> <key>',
      '  nexus key list',
      '',
      `Providers : ${listProviders().join(', ')}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'doctor':
      await cmdDoctor();
      break;
    case 'refresh':
      await cmdRefresh();
      break;
    case 'key':
      cmdKey(rest);
      break;
    case 'help':
    case '--help':
    case '-h':
      cmdHelp();
      break;
    default:
      await cmdLaunch(cmd, rest);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
