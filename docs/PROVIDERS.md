# Providers

## Direct providers

### OpenRouter

Key variable: `OPENROUTER_API_KEY`

```powershell
claude-set-key openrouter sk-or-...
nexus openrouter
```

OpenRouter exposes an Anthropic-compatible endpoint and does not need LiteLLM in Nexus Switch.

## LiteLLM Gateway providers

The following providers use `http://localhost:4000` through LiteLLM:

| Provider | Key variable | Command |
|---|---|---|
| Groq | `GROQ_API_KEY` | `claude-set-key groq ...` |
| Gemini | `GEMINI_API_KEY` | `claude-set-key gemini ...` |
| Cerebras | `CEREBRAS_API_KEY` | `claude-set-key cerebras ...` |
| Mistral | `MISTRAL_API_KEY` | `claude-set-key mistral ...` |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `claude-set-key nvidia ...` |

Start gateway manually:

```powershell
nexus proxy-start
```

Or just select any LiteLLM-backed provider:

```powershell
nexus groq
nexus gemini
nexus cerebras
```

## Ollama

Ollama is launched via:

```powershell
ollama launch claude --model <model>
```

No API key is stored by Nexus Switch for local models.
