// Provider -> the secret name holding its API key.
// Historically these were env-var names (and still are, for template
// resolution like ${OPENROUTER_API_KEY}); now the values live in the
// secret store (core/secrets.ts), never in the global environment.

import { getSecret, setSecret } from './secrets.js';

export const KEY_VARS: Readonly<Record<string, string>> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  nvidia: 'NVIDIA_NIM_API_KEY',
};

export function keyVarFor(provider: string): string | undefined {
  return KEY_VARS[provider];
}

export function readKey(varName: string): string | undefined {
  return getSecret(varName);
}

export function setKey(varName: string, value: string): void {
  setSecret(varName, value);
}
