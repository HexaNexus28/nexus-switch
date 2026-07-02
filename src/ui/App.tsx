import { Box } from 'ink';
import { useState } from 'react';
import type { Provider } from '../types/provider.types.js';
import { Header } from './Header.js';
import { ModelPicker } from './ModelPicker.js';
import { ProviderList } from './ProviderList.js';

export interface Choice {
  provider: Provider;
  model: string;
}

interface Props {
  providers: Provider[];
  /** Reopen directly on this provider's models (hub loop: back where the user was). */
  initialProvider?: Provider | null;
  onChoose: (choice: Choice) => void;
  onQuit: () => void;
}

export function App({ providers, initialProvider, onChoose, onQuit }: Props) {
  const [provider, setProvider] = useState<Provider | null>(initialProvider ?? null);

  return (
    <Box flexDirection="column">
      <Header />
      {!provider ? (
        <ProviderList providers={providers} onSelect={setProvider} onQuit={onQuit} />
      ) : (
        <ModelPicker
          provider={provider}
          onSelect={(model) => onChoose({ provider, model: model.id })}
          onBack={() => setProvider(null)}
        />
      )}
    </Box>
  );
}
