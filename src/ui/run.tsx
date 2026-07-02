import { render } from 'ink';
import type { Provider } from '../types/provider.types.js';
import { loadAllProviders } from '../core/providers.js';
import { launch, releaseStdin } from '../core/launch.js';
import { ensureProxyForProvider } from '../core/proxy.js';
import { ensureClaude, ensureLitellm, ensureOllamaModel, ensureProviderKey } from '../prompt.js';
import { App, type Choice } from './App.js';

/** One picker round: render the TUI, resolve with the choice (null = quit). */
async function pickChoice(providers: Provider[], initialProvider: Provider | null): Promise<Choice | null> {
  const picked: { choice: Choice | null } = { choice: null };
  let app: ReturnType<typeof render>;
  app = render(
    <App
      providers={providers}
      initialProvider={initialProvider}
      onChoose={(c) => {
        picked.choice = c;
        app.unmount();
      }}
      onQuit={() => {
        app.unmount();
      }}
    />,
  );
  // Barrier: wait until Ink has FULLY torn down (terminal restored, its stdin
  // input listeners removed) before any readline prompt or child spawn.
  // Resolving on unmount() alone left stdin half-owned by Ink, so the
  // dependency [o/N] install prompt (e.g. LiteLLM) never received the keypress
  // and hung. waitUntilExit() resolves only after teardown completes.
  await app.waitUntilExit();
  // Ink can leave raw mode half-torn-down; reset it. Readline resumes the
  // stream itself when a prompt attaches, so stdin stays paused here — a
  // flowing stdin would keep a console read pending that later steals the
  // launched claude's first keystrokes (launch() releases it again pre-spawn).
  releaseStdin();
  return picked.choice;
}

/**
 * Interactive hub: pick -> launch -> when claude exits (or a prerequisite
 * fails / is declined), come back to the picker instead of dying to the shell.
 * The picker reopens on the provider the user was in; quitting the picker
 * (q / Esc) is the only way out.
 */
export async function runTui(): Promise<void> {
  const providers = loadAllProviders();
  let lastProvider: Provider | null = null;
  for (;;) {
    const choice = await pickChoice(providers, lastProvider);
    if (!choice) return;
    lastProvider = choice.provider;
    // Prerequisite failures already printed their message; back to the picker.
    if (!(await ensureClaude())) continue;
    if (!(await ensureProviderKey(choice.provider))) continue;
    if (choice.provider.type === 'litellm' && !(await ensureLitellm())) continue;
    if (!(await ensureProxyForProvider(choice.provider.type))) continue;
    if (choice.provider.type === 'ollama' && !(await ensureOllamaModel(choice.model))) continue;
    launch(choice.provider, choice.model, []);
    // claude exited -> loop back to the picker, right where the user was.
  }
}
