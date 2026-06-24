```
            ╭────────────────────╮
            │   N E X U S        ├─●
        ╭───┼────────────────╮   ├─●
      ●─┤   ╰────────────────┼───╯
      ●─┤    S W I T C H     │
        ╰────────────────────╯
        HexaNexus  ·  AI Model Router
```

<div align="center">

[![npm version](https://img.shields.io/npm/v/@hexanexus/nexus-switch)](https://www.npmjs.com/package/@hexanexus/nexus-switch)
[![CI](https://github.com/HexaNexus28/nexus-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/HexaNexus28/nexus-switch/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#install)

**Route Claude Code across 8 AI providers — free tiers first, one command.**

</div>

---

Nexus Switch is a terminal launcher and router for [Claude Code](https://www.anthropic.com/claude-code). It sets the right environment for each provider, optionally starts a local [LiteLLM](https://github.com/BerriAI/litellm) proxy, and hands the terminal to `claude` — no global config, no profile edits.

> Nexus Switch is **not affiliated with Anthropic**. It launches the `claude` CLI you install yourself.

## Install

```bash
npm i -g @hexanexus/nexus-switch
nexus doctor          # verify claude, keys, and proxy are ready
```

**Requires:** Node.js ≥ 18 and [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code).

## Quick start

```bash
nexus                 # interactive TUI — pick provider and model
nexus groq            # launch directly on Groq (free tier)
nexus ollama          # local or cloud Ollama model
nexus openrouter      # OpenRouter free-tier models
```

## Providers

| Provider | Free tier | Account | Notes |
|---|---|---|---|
| **Groq** | ✅ rate-limited | Required | `nexus key set groq <key>` |
| **Gemini** | ✅ generous | Required (Google) | `nexus key set gemini <key>` |
| **Mistral** | ✅ experimental | Required | `nexus key set mistral <key>` |
| **Cerebras** | ✅ ~1M tok/day | Required | `nexus key set cerebras <key>` |
| **NVIDIA NIM** | ✅ 1000 credits | Required | `nexus key set nvidia <key>` |
| **OpenRouter** | ✅ 50 req/day | Required | `nexus key set openrouter <key>` |
| **Ollama local** | ✅ unlimited | None | `ollama pull <model>` |
| **Ollama cloud** | ✅ quota | Required | `ollama signin` |
| **Anthropic** | ❌ paid | Required | `nexus key set anthropic <key>` |

The TUI shows each model's tier clearly:
- **`GRATUIT`** (green) — truly free, no account needed
- **`COMPTE`** (yellow) — free but requires a provider account
- **`PAYANT`** (gray) — billed per token

## Commands

```bash
nexus                             # interactive TUI (provider → model → launch)
nexus <provider> [model] [flags]  # direct launch, e.g. nexus groq llama-3.3-70b-versatile
nexus key set <provider> <key>    # save a provider API key
nexus key list                    # list configured keys (masked)
nexus key delete <provider>       # remove a key
nexus doctor                      # check claude CLI, keys, and proxy status
nexus credits                     # show remaining credits/quota per provider
nexus refresh                     # sync the model catalog from provider APIs
nexus proxy start                 # start the LiteLLM proxy (auto-started on need)
nexus proxy stop                  # stop the proxy
nexus update                      # update nexus-switch to the latest release
nexus uninstall                   # uninstall
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime flow, module map, platform layer
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — per-provider setup and key commands

## Legal

Nexus Switch is an independent open-source project, **not affiliated with or endorsed by Anthropic, Google, Mistral, or any other provider**. "Claude" and "Claude Code" are trademarks of Anthropic, PBC, referenced here solely to describe interoperability. Nexus Switch does not bundle or redistribute Claude Code — it launches the `claude` CLI you install separately. You are responsible for complying with each provider's terms of service. See [NOTICE](NOTICE).

## License

MIT — see [LICENSE](LICENSE).
