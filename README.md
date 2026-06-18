# Nexus Switch

Terminal launcher/router for Claude Code across OpenRouter, Groq, Ollama and LiteLLM-backed providers.

Nexus Switch does **not** replace or redistribute Claude Code. It configures the current terminal environment, optionally starts a local LiteLLM proxy, then launches the installed `claude` CLI with the selected provider/model.

## Why

Claude Code sessions and provider quotas can block your flow. Nexus Switch lets you rotate between:

- OpenRouter direct Anthropic-compatible endpoint
- Groq via local LiteLLM proxy
- Ollama local/cloud
- Gemini, Cerebras, Mistral, NVIDIA NIM via LiteLLM templates
- Anthropic native if you have an API key/subscription

## Install from GitHub

```powershell
git clone https://github.com/HexaNexus28/nexus-switch.git
Set-Location .\nexus-switch
powershell -ExecutionPolicy Bypass -File .\install.ps1
. $PROFILE
nexus doctor
```

## npm/npx install

```bash
npx @hexanexus/nexus-switch install
. $PROFILE
nexus doctor
```

Other commands: `npx @hexanexus/nexus-switch update` and `npx @hexanexus/nexus-switch uninstall`.

## Commands

```powershell
nexus                         # interactive UI
n                          # alias
nexus openrouter              # pick OpenRouter model
nexus groq                    # pick Groq model, auto-starts LiteLLM proxy
nexus ollama                  # pick Ollama model
nexus doctor                  # diagnostics
nexus credits                 # OpenRouter/Groq/Ollama status
nexus proxy-start             # start LiteLLM proxy
nexus proxy-stop              # stop LiteLLM proxy
claude-set-key groq gsk_...   # persist provider key
```

## API keys

Keys are stored as user environment variables, not in JSON files.

```powershell
claude-set-key openrouter sk-or-...
claude-set-key groq gsk_...
claude-set-key gemini AIza...
claude-set-key cerebras ...
claude-set-key mistral ...
claude-set-key nvidia ...
```

Provider templates reference variables such as `${OPENROUTER_API_KEY}` and `${GROQ_API_KEY}`.

## LiteLLM role

Claude Code speaks Anthropic-style configuration (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`). Groq/Gemini/Cerebras/Mistral mostly expose OpenAI-style or provider-specific APIs. LiteLLM runs locally on `http://localhost:4000` and translates the request to the configured provider.

OpenRouter does not need LiteLLM in this setup because it exposes an Anthropic-compatible endpoint directly at `https://openrouter.ai/api`.

## Multi-terminal & login

Nexus Switch sets `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` as **process-level** env vars, so each terminal carries its own provider context independently.

Do **not** run `/logout` to switch to OpenRouter or a LiteLLM provider. Claude Code's OAuth login lives in a single global file (`~/.claude/.credentials.json`); logging out in one terminal logs you out everywhere. When the env vars point to a gateway, Claude Code routes there and ignores the OAuth login — the native login only applies to `api.anthropic.com`. You can stay logged in natively in one terminal and use OpenRouter in another at the same time.

## Repo layout

```text
src/NexusSwitch.ps1          # core UI/launcher
providers/*.json             # provider/model templates, no secrets
litellm/litellm-config.yaml  # local proxy config
install.ps1                  # installs to ~/.nexus-switch and wires $PROFILE
update.ps1                   # updates installed copy
uninstall.ps1                # removes profile hook and installed files
bin/nexus-switch.js          # npm/npx wrapper
```

## Roadmap

- [x] `v0.1` — Windows PowerShell installer + interactive keyboard UI
- [x] `v0.2` — npm/npx wrapper + provider templates (OpenRouter, Groq, Gemini, Cerebras, Mistral, NVIDIA NIM, Ollama, Anthropic)
- [ ] `v0.3` — automatic failover chains
- [ ] `v0.4` — usage stats and local dashboard
- [ ] `v1.0` — cross-platform Nexus Router daemon

## Branding/legal note

Nexus Switch is an independent launcher/router. Claude Code is a separate tool that users must install and authenticate according to Anthropic's terms.
