# Architecture

Nexus Switch is a terminal launcher/router for Claude Code.

## Runtime flow

```text
User terminal
  -> nexus UI
  -> provider JSON selection
  -> process env vars
  -> claude CLI
```

For direct Anthropic-compatible providers:

```text
Claude Code
  -> ANTHROPIC_BASE_URL=https://openrouter.ai/api
  -> OpenRouter
```

For LiteLLM-backed providers:

```text
Claude Code
  -> ANTHROPIC_BASE_URL=http://localhost:4000
  -> LiteLLM Gateway
  -> Groq / Gemini / Cerebras / Mistral / NVIDIA NIM
```

For Ollama:

```text
nexus
  -> ollama launch claude --model <model>
```

## Design rules

- One terminal = one active provider context.
- No global `settings.local.json` routing state.
- Provider/model catalog lives in `providers/*.json`.
- Secrets are stored in user environment variables.
- LiteLLM is an optional local gateway, not bundled.

## Extension points

- Add a provider JSON file.
- Add matching LiteLLM entries if provider type is `litellm`.
- Add key mapping in `_provider_env_map` if a new secret variable is needed.
