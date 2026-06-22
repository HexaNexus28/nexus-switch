import { render } from 'ink';
import { loadAllProviders } from '../core/providers.js';
import { launch } from '../core/launch.js';
import { ensureProxyForProvider } from '../core/proxy.js';
import { ensureClaude, ensureLitellm, ensureOllamaModel } from '../prompt.js';
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

  const choice = await new Promise<Choice | null>((resolve) => {
    const { unmount } = render(
      <App
        providers={providers}
        onChoose={(c) => {
          unmount();
          resolve(c);
        }}
        onQuit={() => {
          unmount();
          resolve(null);
        }}
      />,
    );
  });
  // unmount() ran synchronously before resolve, so Ink has restored the
  // terminal here. Re-assert a clean interactive stdin before handing it to
  // the child; spawning with a half-rendered stdin makes claude / ollama fall
  // back to non-interactive --print mode -> instant exit, no UI.
  restoreStdin();

  if (!choice) return;
  if (!(await ensureClaude())) {
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
