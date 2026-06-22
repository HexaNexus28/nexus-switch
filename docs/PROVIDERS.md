# Providers

Keys are persisted with `nexus key set <provider> <key>` into a per-user store at
`~/.nexus-switch/` — DPAPI-encrypted on Windows (fallback owner-only file), and a
`0600` file on macOS/Linux. They never become global environment variables and are
injected only into the launched `claude` (or the LiteLLM gateway) process.

## Direct providers

### OpenRouter

Key variable: `OPENROUTER_API_KEY`

```bash
nexus key set openrouter sk-or-...
nexus openrouter
```

OpenRouter exposes an Anthropic-compatible endpoint and does not need LiteLLM in Nexus Switch.

## LiteLLM Gateway providers

The following providers use `http://localhost:4000` through LiteLLM:

| Provider | Key variable | Command |
|---|---|---|
| Groq | `GROQ_API_KEY` | `nexus key set groq ...` |
| Gemini | `GEMINI_API_KEY` | `nexus key set gemini ...` |
| Cerebras | `CEREBRAS_API_KEY` | `nexus key set cerebras ...` |
| Mistral | `MISTRAL_API_KEY` | `nexus key set mistral ...` |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `nexus key set nvidia ...` |

Start the gateway manually:

```bash
nexus proxy start
```

Or just select any LiteLLM-backed provider (auto-starts the gateway):

```bash
nexus groq
nexus gemini
nexus cerebras
```

## Ollama

Ollama is launched via:

```bash
ollama launch claude --model <model>
```

No API key is stored by Nexus Switch for local models. `:cloud` models require an
Ollama sign-in.
