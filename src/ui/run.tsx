import { render } from 'ink';
import { loadAllProviders } from '../core/providers.js';
import { launch } from '../core/launch.js';
import { ensureProxyForProvider } from '../core/proxy.js';
import { ensureClaude, ensureLitellm } from '../prompt.js';
import { App, type Choice } from './App.js';

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
  launch(choice.provider, choice.model, []);
}
