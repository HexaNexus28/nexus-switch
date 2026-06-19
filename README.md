# Nexus Switch

Cross-platform terminal launcher/router for Claude Code across OpenRouter, Groq,
Ollama and LiteLLM-backed providers. One codebase (Node/TypeScript), runs
wherever `claude` runs — Windows, macOS, Linux.

Nexus Switch does **not** replace or redistribute Claude Code. It configures the
current terminal environment, optionally starts a local LiteLLM proxy, then
launches the installed `claude` CLI with the selected provider/model.

> **Status:** `1.0.0` (Node/TS) is the cross-platform rewrite. The published
> `0.2.x` line is the legacy Windows-only PowerShell implementation. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#migration-from-02x).

## Prerequisites

- **Claude Code CLI** — required. Nexus is a launcher, not a standalone agent;
  every provider (including Ollama) runs through `claude`. Install with:
  ```bash
  npm i -g @anthropic-ai/claude-code
  ```
  `nexus doctor` flags it if missing, and `nexus <provider>` offers to install it
  on first launch.
- **Node.js >= 18**.
- **Provider credentials** — an OpenRouter/Groq API key, or an Ollama sign-in for
  `:cloud` models. See [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Why

Claude Code sessions and provider quotas can block your flow. Nexus Switch lets
you rotate between, per terminal, without global state:

- OpenRouter direct Anthropic-compatible endpoint
- Groq via local LiteLLM proxy
- Ollama local/cloud
- Gemini, Cerebras, Mistral, NVIDIA NIM via LiteLLM templates
- Anthropic native if you have an API key/subscription

## Install

```bash
npm i -g @hexanexus/nexus-switch
nexus doctor
```

No shell profile editing — `nexus` is a self-contained bin available immediately.

## Commands

```bash
nexus                         # interactive TUI
nexus openrouter [model]      # pick / launch an OpenRouter model
nexus groq [model]            # Groq, auto-starts the LiteLLM proxy
nexus ollama [model]          # Ollama local/cloud
nexus doctor                  # diagnostics (claude present, key validity, proxy)
nexus refresh                 # refresh the model catalog from provider APIs
nexus credits                 # OpenRouter/Groq/Ollama status
nexus key set groq gsk_...    # persist a provider key
nexus key list                # list configured keys (masked)
nexus proxy start             # start the LiteLLM proxy
nexus proxy stop              # stop the LiteLLM proxy
nexus update                  # update to the latest release
nexus uninstall               # remove
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime flow, modules, platform layer.
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — per-provider keys and commands.

## Legal

Nexus Switch is independent and **not affiliated with or endorsed by** Anthropic
or any provider. "Claude" and "Claude Code" are trademarks of Anthropic, PBC,
used here only to describe interoperability. Nexus Switch does **not** bundle or
redistribute Claude Code — it launches the `claude` CLI you install yourself. You
are responsible for complying with the terms of service of Anthropic and of each
provider whose keys you configure. See [NOTICE](NOTICE).

## License

MIT — see [LICENSE](LICENSE).
