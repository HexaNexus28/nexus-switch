<div align="center">

# ◢ NEXUS SWITCH

**AI model router · by HexaNexus**

[![npm version](https://img.shields.io/npm/v/@hexanexus/nexus-switch)](https://www.npmjs.com/package/@hexanexus/nexus-switch)
[![CI](https://github.com/HexaNexus28/nexus-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/HexaNexus28/nexus-switch/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#install)

**Route Claude Code across 8 AI providers — free tiers first, one command.**

</div>

---

Nexus Switch is a terminal launcher and router for [Claude Code](https://www.anthropic.com/claude-code). It sets the right environment for each provider, starts an in-process loopback gateway for OpenAI-compatible providers (it translates Anthropic ⇄ OpenAI and forwards only the fields the provider understands), and hands the terminal to `claude` — no global config, no profile edits, no Python proxy.

> Nexus Switch is **not affiliated with Anthropic**. It launches the `claude` CLI you install yourself.

## Install

```bash
npm i -g @hexanexus/nexus-switch
nexus doctor          # verify claude and keys are ready
```

**Requires:** Node.js ≥ 18 and [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code).

## Quick start

```bash
nexus                 # interactive TUI — pick provider and model
nexus groq            # launch directly on Groq (free tier)
nexus ollama          # local or cloud Ollama model
nexus openrouter      # OpenRouter free-tier models
```

The TUI is a hub: models are sorted cheapest-first, every row carries its
billing tier, and the highlighted model's real cost is spelled out before you
launch anything. When claude exits, you land back in the picker — not in the
shell.

```text
 ◢ NEXUS SWITCH

 Groq  ·  9 modeles
 ────────────────────────────────────────────────────────────────
 ▸ ● QUOTA   Llama 3.3 70B Versatile   cloud · 131K · $0.59/0.79
   ● QUOTA   GPT-OSS 120B              cloud · 131K · $0.15/0.6
   ● QUOTA   Qwen3 32B                 cloud · 131K · $0.29/0.59

 ▍ Gratuit jusqu'au quota (compte groq gratuit requis)
   — au-delà : $0.59 in / $0.79 out par M tokens.

 ↑↓ naviguer · ⏎ lancer · ← providers · q quitter
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
| **Ollama cloud** | ✅ quota (some models Pro-only) | Required | `ollama signin` |
| **Anthropic** | ❌ paid | Required | `nexus key set anthropic <key>` |

The TUI labels every model's billing tier, and the picker explains the
highlighted model's cost in plain words:
- **`GRATUIT`** (green) — runs locally, no account, never billed
- **`QUOTA`** (yellow) — free provider account required; free up to a usage
  quota, then blocked or billed
- **`PAYANT`** (red) — billed per token from the first request
- **`UPGRADE`** (magenta) — unusable without a paid subscription (e.g. some
  Ollama cloud models 403 on a free account)

## Commands

```bash
nexus                             # interactive TUI (provider → model → launch)
nexus <provider> [model] [flags]  # direct launch, e.g. nexus groq llama-3.3-70b-versatile
nexus key set <provider> <key>    # save a provider API key
nexus key list                    # list configured keys (masked)
nexus key delete <provider>       # remove a key
nexus doctor                      # check claude CLI and keys
nexus credits                     # show remaining credits/quota per provider
nexus refresh                     # sync the model catalog from provider APIs
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
