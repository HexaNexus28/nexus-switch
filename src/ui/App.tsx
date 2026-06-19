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
  onChoose: (choice: Choice) => void;
  onQuit: () => void;
}

export function App({ providers, onChoose, onQuit }: Props) {
  const [provider, setProvider] = useState<Provider | null>(null);

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
