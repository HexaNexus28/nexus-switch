import { render } from 'ink';
import { loadAllProviders } from '../core/providers.js';
import { launch } from '../core/launch.js';
import { ensureProxyForProvider } from '../core/proxy.js';
import { ensureClaude, ensureLitellm, ensureOllamaModel, ensureProviderKey } from '../prompt.js';
import { App, type Choice } from './App.js';

/**
 * Restore stdin to a clean interactive state after Ink released it. The child
 * CLI (claude / ollama launch claude) decides interactive-vs-`--print` from
 * stdin being a real TTY; a half-restored stream makes it fall back to --print,
 * which exits immediately with no UI ("returns to the menu").
 */
function restoreStdin(): void {
  const { stdin } = process;
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
  stdin.resume();
}

/** Render the interactive TUI, then launch the selected provider/model. */
export async function runTui(): Promise<void> {
  const providers = loadAllProviders();

  const picked: { choice: Choice | null } = { choice: null };
  let app: ReturnType<typeof render>;
  app = render(
    <App
      providers={providers}
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
  restoreStdin();

  const { choice } = picked;
  if (!choice) return;
  if (!(await ensureClaude())) {
    process.exitCode = 1;
    return;
  }
  if (!(await ensureProviderKey(choice.provider))) {
    process.exitCode = 1;
    return;
  }
  if (choice.provider.type === 'litellm' && !(await ensureLitellm())) {
    process.exitCode = 1;
    return;
  }
  if (!(await ensureProxyForProvider(choice.provider.type))) {
    process.exitCode = 1;
    return;
  }
  if (choice.provider.type === 'ollama' && !(await ensureOllamaModel(choice.model))) {
    process.exitCode = 1;
    return;
  }
  launch(choice.provider, choice.model, []);
}
