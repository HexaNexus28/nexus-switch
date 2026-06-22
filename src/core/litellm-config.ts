// LiteLLM config generator — single source of truth = providers/*.json + store.
//
// The committed litellm-config.yaml is gone: it could drift from the provider
// catalog (stale model names) and from the actual keys present. We rebuild the
// YAML on demand from the litellm-typed provider files, keeping only the model
// groups whose API key exists in the store. Keys are NOT inlined; they stay as
// `os.environ/<VAR>` and are injected into the LiteLLM child's env by proxy.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyVarFor } from './keys.js';
import { listProviders, loadProvider } from './providers.js';
import { getSecret, nexusDataDir } from './secrets.js';

// Anthropic-native fields Claude Code emits that have no OpenAI equivalent.
// drop_params only strips known OpenAI params, so these must be listed
// explicitly or they reach the provider and 400.
const ADDITIONAL_DROP_PARAMS = ['output_config', 'mcp_servers', 'container', 'thinking'];

interface ModelEntry {
  modelName: string;
  keyVar: string;
}

export function litellmDir(): string {
  return join(nexusDataDir(), 'litellm');
}

export function generatedConfigPath(): string {
  return join(litellmDir(), 'litellm-config.generated.yaml');
}

/** Models from litellm providers whose key is present in the store, in stable order. */
function collectModels(): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const name of [...listProviders()].sort()) {
    const provider = loadProvider(name);
    if (provider.type !== 'litellm') continue;
    const keyVar = keyVarFor(name);
    if (!keyVar || !getSecret(keyVar)) continue;
    for (const model of provider.models) {
      entries.push({ modelName: model.id, keyVar });
    }
  }
  return entries;
}

/** Render the YAML deterministically (stable order => stable hash => no churn). */
function renderConfig(models: ModelEntry[]): string {
  const lines: string[] = ['model_list:'];
  for (const { modelName, keyVar } of models) {
    lines.push(
      `  - model_name: ${modelName}`,
      '    litellm_params:',
      `      model: ${modelName}`,
      `      api_key: os.environ/${keyVar}`,
      '',
    );
  }
  lines.push(
    'litellm_settings:',
    '  drop_params: true',
    `  additional_drop_params: [${ADDITIONAL_DROP_PARAMS.map((p) => `"${p}"`).join(', ')}]`,
    '  modify_params: true',
    '',
    'general_settings:',
    '  master_key: os.environ/NEXUS_PROXY_KEY',
    '',
  );
  return lines.join('\n');
}

export interface GeneratedConfig {
  path: string;
  content: string;
  /** Env-var names the LiteLLM child must receive (provider keys for the selected groups). */
  keyVars: string[];
  /** False when no provider key is present => nothing to serve. */
  hasModels: boolean;
}

/** Build the desired config content (no disk write). */
export function buildLitellmConfig(): GeneratedConfig {
  const models = collectModels();
  const keyVars = [...new Set(models.map((m) => m.keyVar))];
  return { path: generatedConfigPath(), content: renderConfig(models), keyVars, hasModels: models.length > 0 };
}

/** Write the generated config to ~/.nexus-switch/litellm/ and return its descriptor. */
export function writeLitellmConfig(): GeneratedConfig {
  const generated = buildLitellmConfig();
  mkdirSync(litellmDir(), { recursive: true });
  writeFileSync(generated.path, generated.content);
  return generated;
}
