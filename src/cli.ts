import { spawnSync } from 'node:child_process';
import { refreshOpenRouter } from './core/catalog.js';
import { litellmKeyStatus, openRouterCredits } from './core/credits.js';
import { runDoctor } from './core/doctor.js';
import { KEY_VARS, keyVarFor, readKey } from './core/keys.js';
import { launch } from './core/launch.js';
import { listProviders, loadProvider } from './core/providers.js';
import { ensureProxyForProvider, startProxy, stopProxy } from './core/proxy.js';
import { persistKey } from './platform/persist.js';
import { ensureClaude } from './prompt.js';

function mark(ok: boolean): string {
  return ok ? 'OK' : 'KO';
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
  if (!(await ensureProxyForProvider(provider.type))) {
    process.exitCode = 1;
    return;
  }
  const hasModel = Boolean(rest[0]) && !rest[0]!.startsWith('-');
  const model = hasModel ? rest[0]! : provider.default;
  const passthrough = hasModel ? rest.slice(1) : rest;
  launch(provider, model, passthrough);
}

async function cmdProxy(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'start') {
    if (await startProxy()) console.log('Proxy LiteLLM pret sur :4000');
    else process.exitCode = 1;
    return;
  }
  if (sub === 'stop') {
    stopProxy();
    console.log('Proxy LiteLLM arrete.');
    return;
  }
  console.error('Usage: nexus proxy start|stop');
  process.exitCode = 1;
}

async function cmdCredits(): Promise<void> {
  console.log(`OpenRouter : ${await openRouterCredits()}`);
  for (const { provider, present } of litellmKeyStatus()) {
    console.log(`${provider.padEnd(10)} : ${present ? 'cle presente' : 'absente'}`);
  }
  console.log('Ollama     : local illimite · cloud quota (https://ollama.com/dashboard)');
}

function cmdUpdate(): void {
  spawnSync('npm', ['i', '-g', '@hexanexus/nexus-switch@latest'], { stdio: 'inherit' });
}

function cmdUninstall(): void {
  spawnSync('npm', ['rm', '-g', '@hexanexus/nexus-switch'], { stdio: 'inherit' });
}

function cmdHelp(): void {
  console.log(
    [
      'Nexus Switch',
      '',
      'Usage:',
      '  nexus                       interactive TUI',
      '  nexus <provider> [model] [-- claude flags]',
      '  nexus doctor',
      '  nexus credits',
      '  nexus refresh',
      '  nexus key set <provider> <key>',
      '  nexus key list',
      '  nexus proxy start|stop',
      '  nexus update | uninstall',
      '',
      `Providers : ${listProviders().join(', ')}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    if (process.stdin.isTTY) {
      const { runTui } = await import('./ui/run.js');
      await runTui();
    } else {
      cmdHelp();
    }
    return;
  }
  const cmd = args[0]!;
  const rest = args.slice(1);
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
    case 'proxy':
      await cmdProxy(rest);
      break;
    case 'credits':
      await cmdCredits();
      break;
    case 'update':
      cmdUpdate();
      break;
    case 'uninstall':
      cmdUninstall();
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
