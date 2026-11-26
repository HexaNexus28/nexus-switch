import { spawnSync } from 'node:child_process';
import { render } from 'ink';
import type { Provider } from '../types/provider.types.js';
import { loadAllProviders } from '../core/providers.js';
import { launch, releaseStdin, runNpm } from '../core/launch.js';
import { runReport } from '../core/report.js';
import { App, type Choice, type Intent } from './App.js';
import { t } from '../i18n/index.js';

interface SessionState {
  provider: Provider | null;
  retryChoice: Choice | null;
}

/** One Ink session: render the TUI, resolve with the intent (null = quit). */
async function session(providers: Provider[], state: SessionState): Promise<Intent | null> {
  const resolved: { intent: Intent | null } = { intent: null };
  let app: ReturnType<typeof render>;
  app = render(
    <App
      providers={providers}
      initialProvider={state.provider}
      initialChoice={state.retryChoice}
      onIntent={(intent) => {
        resolved.intent = intent;
        app.unmount();
      }}
      onQuit={() => {
        app.unmount();
      }}
    />,
  );
  // Barrier: wait until Ink has FULLY torn down (terminal restored, its stdin
  // listeners removed) before any child inherits the console.
  await app.waitUntilExit();
  // Reset raw mode and stop reading stdin: a lingering parent console read
  // steals the next reader's keystrokes on Windows (launch() does it again
  // pre-spawn, belt and braces).
  releaseStdin();
  return resolved.intent;
}

/**
 * Interactive hub. Everything that READS stdin happens inside Ink (picker,
 * [o/N] dialogs, key input) — a readline prompt after an Ink teardown loses
 * keystrokes on Windows. Console-bound ACTIONS (npm/pip installs, ollama pull,
 * proxy boot, claude itself) run between Ink sessions, then the TUI comes back
 * where the user was: after claude exits, after an install, after a decline.
 * Quitting the picker (q / Esc) is the only way out.
 */
export async function runTui(): Promise<void> {
  const providers = loadAllProviders();
  if (providers.length === 0) {
    console.error(t.providers.noneFatal);
    process.exitCode = 1;
    return;
  }
  const state: SessionState = { provider: null, retryChoice: null };
  for (;;) {
    const intent = await session(providers, state);
    if (!intent) return;
    if (intent.kind === 'report') {
      runReport();
      continue;
    }
    const { choice } = intent;
    state.provider = choice.provider;
    state.retryChoice = null;
    switch (intent.kind) {
      case 'install': {
        const status = runNpm(['i', '-g', '@anthropic-ai/claude-code']);
        if (status !== 0) console.error(t.setup.claudeInstallFailed);
        state.retryChoice = choice; // re-check the same choice, then launch
        break;
      }
      case 'pull': {
        const pull = spawnSync('ollama', ['pull', choice.model], { stdio: 'inherit' });
        if (pull.error || (pull.status !== null && pull.status !== 0)) {
          console.error(t.setup.ollamaPullFailed(choice.model));
          break;
        }
        state.retryChoice = choice;
        break;
      }
      case 'launch':
        await launch(choice.provider, choice.model, []);
        break;
    }
  }
}
