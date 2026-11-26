import { Box } from 'ink';
import { useEffect, useState } from 'react';
import type { Provider } from '../types/provider.types.js';
import { keyVarFor, readKey, setKey } from '../core/keys.js';
import { claudeExists } from '../core/launch.js';
import { ollamaModelMissing } from '../prompt.js';
import { Confirm } from './Confirm.js';
import { Header } from './Header.js';
import { KeyPrompt } from './KeyPrompt.js';
import { ModelPicker } from './ModelPicker.js';
import { ProviderList } from './ProviderList.js';
import { t } from '../i18n/index.js';

export interface Choice {
  provider: Provider;
  model: string;
}

/**
 * What the TUI session resolved to. Console-bound work (npm/pip/ollama pull,
 * proxy boot, claude launch) runs OUTSIDE Ink: run.tsx unmounts, acts, and
 * re-renders. Everything that READS stdin stays inside Ink — a readline prompt
 * after an Ink teardown loses keystrokes on Windows (cancelled raw console
 * read), which is why dialogs live here and not in prompt.ts.
 */
export type Intent =
  | { kind: 'launch'; choice: Choice }
  | { kind: 'install'; tool: 'claude'; choice: Choice }
  | { kind: 'pull'; choice: Choice }
  | { kind: 'report' };

interface Props {
  providers: Provider[];
  /** Reopen directly on this provider's models (hub loop: back where the user was). */
  initialProvider?: Provider | null;
  /** Re-run the prerequisite chain for this choice on mount (post-install retry). */
  initialChoice?: Choice | null;
  onIntent: (intent: Intent) => void;
  onQuit: () => void;
}

type Stage =
  | { kind: 'providers' }
  | { kind: 'models'; provider: Provider }
  | { kind: 'key'; choice: Choice; varName: string }
  | { kind: 'confirm'; title: string; message: string; command?: string; intent: Exclude<Intent, { kind: 'report' }> };

export function App({ providers, initialProvider, initialChoice, onIntent, onQuit }: Props) {
  const [stage, setStage] = useState<Stage>(
    initialProvider ? { kind: 'models', provider: initialProvider } : { kind: 'providers' },
  );

  /**
   * Walk the prerequisite chain for a picked model. Each missing dependency
   * becomes an in-Ink dialog; when everything is present the launch intent
   * fires. Checks are spawnSync probes (fast) run on selection, not on render.
   */
  function advance(choice: Choice): void {
    if (!claudeExists()) {
      setStage({
        kind: 'confirm',
        title: t.dialogs.claudeMissingTitle,
        message: t.dialogs.claudeMissingMessage,
        command: 'npm i -g @anthropic-ai/claude-code',
        intent: { kind: 'install', tool: 'claude', choice },
      });
      return;
    }
    const varName = choice.provider.id ? keyVarFor(choice.provider.id) : undefined;
    if (varName && !readKey(varName)) {
      setStage({ kind: 'key', choice, varName });
      return;
    }
    if (choice.provider.type === 'ollama' && ollamaModelMissing(choice.model)) {
      setStage({
        kind: 'confirm',
        title: t.dialogs.modelMissingTitle,
        message: t.dialogs.modelMissingMessage(choice.model),
        command: `ollama pull ${choice.model}`,
        intent: { kind: 'pull', choice },
      });
      return;
    }
    onIntent({ kind: 'launch', choice });
  }

  // Post-install retry: re-check the same choice as soon as the TUI is back.
  useEffect(() => {
    if (initialChoice) advance(initialChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column">
      <Header />
      {stage.kind === 'providers' ? (
        <ProviderList
          providers={providers}
          onSelect={(p) => setStage({ kind: 'models', provider: p })}
          onReport={() => onIntent({ kind: 'report' })}
          onQuit={onQuit}
        />
      ) : stage.kind === 'models' ? (
        <ModelPicker
          provider={stage.provider}
          onSelect={(model) => advance({ provider: stage.provider, model: model.id })}
          onBack={() => setStage({ kind: 'providers' })}
        />
      ) : stage.kind === 'key' ? (
        <KeyPrompt
          providerId={stage.choice.provider.id ?? '?'}
          varName={stage.varName}
          onSubmit={(value) => {
            setKey(stage.varName, value);
            advance(stage.choice);
          }}
          onCancel={() => setStage({ kind: 'models', provider: stage.choice.provider })}
        />
      ) : (
        <Confirm
          title={stage.title}
          message={stage.message}
          command={stage.command}
          onAnswer={(yes) => {
            if (yes) onIntent(stage.intent);
            else setStage({ kind: 'models', provider: stage.intent.choice.provider });
          }}
        />
      )}
    </Box>
  );
}
