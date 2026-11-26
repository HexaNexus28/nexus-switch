import { refreshOllama, refreshOpenRouter } from './core/catalog.js';
import { canFallBack, fallbackPool } from './core/chain.js';
import { readConfig, writeConfig, type FallbackSetting } from './core/config.js';
import { gatewayKeyStatus, openRouterCredits } from './core/credits.js';
import { runDoctor } from './core/doctor.js';
import { deleteKey, KEY_VARS, keyVarFor, readKey, setKey } from './core/keys.js';
import { launch, runNpm } from './core/launch.js';
import { listProviders, loadAllProviders, loadProvider } from './core/providers.js';
import { runReport } from './core/report.js';
import { migrateLegacyEnv, purgeLegacyEnv, purgeLegacyLitellm, wipeSecretStore } from './core/secrets.js';
import { availableUpdate, refreshUpdateCache } from './core/update.js';
import { askYesNo, ensureClaude, ensureOllamaModel, ensureProviderKey } from './prompt.js';
import { t } from './i18n/index.js';

function mark(ok: boolean): string {
  return ok ? 'OK' : 'KO';
}

async function cmdDoctor(): Promise<void> {
  const report = await runDoctor();
  const claudeNote = report.claude ? '' : '  -> npm i -g @anthropic-ai/claude-code';
  console.log(`${mark(report.claude)}  Claude Code CLI${claudeNote}`);
  for (const k of report.keys) {
    const status = !k.present ? '..' : k.valid === false ? 'KO' : 'OK';
    const note = k.valid === true ? t.cli.keyValid : k.valid === false ? t.cli.keyRejected : k.present ? t.cli.keyPresent : t.cli.keyAbsent;
    console.log(`${status}  ${k.provider.padEnd(10)} ${k.varName.padEnd(20)} ${note}`);
  }
}

async function cmdRefresh(): Promise<void> {
  const { kept, removed } = await refreshOpenRouter();
  const tail = removed.length ? ` : ${removed.join(', ')}` : '';
  console.log(t.cli.refreshOpenRouter(kept, removed.length, tail));
  try {
    const { models } = refreshOllama();
    console.log(t.cli.refreshOllama(models));
  } catch (err) {
    console.log(`Ollama    : ${err instanceof Error ? err.message : t.cli.skipped}`);
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
      console.error(t.cli.unsupportedProvider(provider));
      process.exitCode = 1;
      return;
    }
    setKey(varName, value);
    console.log(t.setup.keySaved(varName));
    return;
  }
  if (sub === 'delete' && provider) {
    const varName = keyVarFor(provider);
    if (!varName) {
      console.error(t.cli.unsupportedProvider(provider));
      process.exitCode = 1;
      return;
    }
    deleteKey(varName);
    console.log(t.cli.keyDeleted(varName));
    return;
  }
  console.error(t.cli.keyUsage);
  process.exitCode = 1;
}

/**
 * `nexus chain`: fallback is off until the user turns it on HERE, after seeing
 * where their code would go and what each provider does with it.
 */
async function cmdChain(args: string[]): Promise<void> {
  const yes = args.includes('--yes');
  const [sub, ...ids] = args.filter((a) => a !== '--yes');
  const config = readConfig();
  if (sub === undefined) {
    const fallback = config.fallback;
    console.log(
      !fallback
        ? t.fallback.showOff
        : fallback.mode === 'auto'
          ? t.fallback.showAuto
          : t.fallback.showManual(fallback.providers.join(' -> ')),
    );
    return;
  }
  if (sub === 'off') {
    delete config.fallback;
    writeConfig(config);
    console.log(t.fallback.offSet);
    return;
  }
  if ((sub !== 'auto' && sub !== 'set') || (sub === 'set' && ids.length === 0)) {
    console.error(t.fallback.usage);
    process.exitCode = 1;
    return;
  }
  for (const id of ids) {
    if (!listProviders().includes(id) || loadProvider(id).type !== 'gateway') {
      console.error(t.fallback.notGateway(id));
      process.exitCode = 1;
      return;
    }
  }
  const setting: FallbackSetting = sub === 'auto' ? { mode: 'auto' } : { mode: 'manual', providers: ids };
  const pool = fallbackPool(loadAllProviders(), setting.mode === 'manual' ? setting.providers : undefined).filter(canFallBack);
  if (pool.length === 0) {
    console.error(t.fallback.noneUsable);
    process.exitCode = 1;
    return;
  }
  const width = Math.max(...pool.map((p) => p.name.length));
  console.log(t.fallback.consentIntro);
  for (const p of pool) {
    const policy = p.data_policy;
    console.log(`  ${p.name.padEnd(width)}  ${policy ? `${policy.summary} (${policy.checked})` : t.fallback.policyUnknown}`);
  }
  console.log(t.fallback.consentFooter);
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(t.fallback.needYes);
      process.exitCode = 1;
      return;
    }
    if (!(await askYesNo(t.fallback.confirm))) {
      console.log(t.fallback.cancelled);
      return;
    }
  }
  writeConfig({ ...config, fallback: setting });
  console.log(setting.mode === 'auto' ? t.fallback.autoSet : t.fallback.manualSet(setting.providers.join(' -> ')));
}

async function cmdLaunch(name: string, rest: string[]): Promise<void> {
  if (!listProviders().includes(name)) {
    console.error(t.cli.unknownProvider(name, listProviders().join(', ')));
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
  if (update) console.error(t.cli.updateAvailable(update));
  void refreshUpdateCache();
  await launch(provider, model, passthrough);
}

async function cmdCredits(): Promise<void> {
  console.log(`OpenRouter : ${await openRouterCredits()}`);
  for (const { provider, present } of gatewayKeyStatus()) {
    console.log(`${provider.padEnd(10)} : ${present ? t.cli.creditsKeyPresent : t.cli.keyAbsent}`);
  }
  console.log(t.cli.creditsOllama);
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
  console.log(t.cli.uninstalled);
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
      '  nexus chain [auto | set <provider>... | off]   fallback when a free quota runs out (off by default)',
      '  nexus report                report a problem (pre-filled GitHub issue)',
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
    case 'chain':
      await cmdChain(rest);
      break;
    case 'credits':
      await cmdCredits();
      break;
    case 'report':
      runReport();
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
