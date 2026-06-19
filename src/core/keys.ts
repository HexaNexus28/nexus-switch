// Provider -> environment variable holding its API key.
// Mirrors the legacy _provider_env_map. LiteLLM providers store their real key
// here, even though their provider env template points at the local proxy.

export const KEY_VARS: Readonly<Record<string, string>> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  nvidia: 'NVIDIA_NIM_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
};

export function keyVarFor(provider: string): string | undefined {
  return KEY_VARS[provider];
}

export function readKey(varName: string): string | undefined {
  return process.env[varName];
}
