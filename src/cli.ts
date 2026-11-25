import { refreshOllama, refreshOpenRouter } from './core/catalog.js';
import { gatewayKeyStatus, openRouterCredits } from './core/credits.js';
import { runDoctor } from './core/doctor.js';
import { deleteKey, KEY_VARS, keyVarFor, readKey, setKey } from './core/keys.js';
import { launch, runNpm } from './core/launch.js';
import { listProviders, loadProvider } from './core/providers.js';
import { migrateLegacyEnv, purgeLegacyEnv, purgeLegacyLitellm, wipeSecretStore } from './core/secrets.js';
import { availableUpdate, refreshUpdateCache } from './core/update.js';
import { ensureClaude, ensureOllamaModel, ensureProviderKey } from './prompt.js';

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
  try {
    const { models } = refreshOllama();
    console.log(`Ollama    : ${models} modeles (depuis ollama list)`);
  } catch (err) {
    console.log(`Ollama    : ${err instanceof Error ? err.message : 'ignore'}`);
  }
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
    setKey(varName, value);
    console.log(`${varName} enregistree dans ~/.nexus-switch.`);
    return;
  }
  if (sub === 'delete' && provider) {
    const varName = keyVarFor(provider);
    if (!varName) {
      console.error(`Provider non supporte : ${provider}`);
      process.exitCode = 1;
      return;
    }
    deleteKey(varName);
    console.log(`${varName} supprimee de ~/.nexus-switch.`);
    return;
  }
  console.error('Usage: nexus key set <provider> <cle> | nexus key list | nexus key delete <provider>');
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
  if (!(await ensureProviderKey(provider))) {
    process.exitCode = 1;
    return;
  }
  const hasModel = Boolean(rest[0]) && !rest[0]!.startsWith('-');
  const model = hasModel ? rest[0]! : provider.default;
  // Drop the optional `--` separator: the documented form is
  // `nexus <provider> [model] [-- claude flags]`, and forwarding the literal
  // `--` makes claude treat the flags as positional args (so `nexus groq -- -p
  // "..."` silently fell back to an interactive session instead of printing).
  const tail = hasModel ? rest.slice(1) : rest;
  const passthrough = tail[0] === '--' ? tail.slice(1) : tail;
  if (provider.type === 'ollama' && !(await ensureOllamaModel(model))) {
    process.exitCode = 1;
    return;
  }
  const update = availableUpdate();
  if (update) console.error(`nexus ${update} disponible -> nexus update`);
  void refreshUpdateCache();
  await launch(provider, model, passthrough);
}

async function cmdCredits(): Promise<void> {
  console.log(`OpenRouter : ${await openRouterCredits()}`);
  for (const { provider, present } of gatewayKeyStatus()) {
    console.log(`${provider.padEnd(10)} : ${present ? 'cle presente' : 'absente'}`);
  }
  console.log('Ollama     : local illimite · cloud quota (https://ollama.com/dashboard)');
}

function cmdUpdate(): void {
  const status = runNpm(['i', '-g', '@hexanexus/nexus-switch@latest']);
  if (status !== 0) process.exitCode = status ?? 1;
}

function cmdUninstall(): void {
  // Leave nothing behind: wipe the store and purge any residual global env vars
  // from the pre-store era.
  wipeSecretStore();
  for (const varName of [...Object.values(KEY_VARS), 'NEXUS_PROXY_KEY']) purgeLegacyEnv(varName);
  console.log('Secrets et config supprimes (~/.nexus-switch + env global purge).');
  const status = runNpm(['rm', '-g', '@hexanexus/nexus-switch']);
  if (status !== 0) process.exitCode = status ?? 1;
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
      '  nexus key delete <provider>',
      '  nexus update | uninstall',
      '',
      `Providers : ${listProviders().join(', ')}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  // One-time: pull any nexus-managed key still in the global env into the store,
  // then purge it from the env. Silent and idempotent (guarded by a marker).
  try {
    migrateLegacyEnv();
  } catch {
    /* migration is best-effort; never block a launch on it */
  }
  purgeLegacyLitellm();
  const args = process.argv.slice(2);
  if (args.length === 0) {
    if (process.stdin.isTTY) {
      // Background: the TUI stays open long enough; the NEXT run shows the result.
      void refreshUpdateCache();
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
