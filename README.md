<div align="center">

# ◢ NEXUS SWITCH

**Claude Code on free tiers.**<br>
Zero config. No surprise bills. Keys stay safe.

[![npm version](https://img.shields.io/npm/v/@hexanexus/nexus-switch)](https://www.npmjs.com/package/@hexanexus/nexus-switch)
[![CI](https://github.com/HexaNexus28/nexus-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/HexaNexus28/nexus-switch/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#install)

```bash
npm i -g @hexanexus/nexus-switch
nexus
```

</div>

---

Want to use [Claude Code](https://www.anthropic.com/claude-code) without a paid Anthropic plan?
Nexus Switch runs it on the free tiers of Groq, Gemini, Mistral, NVIDIA, OpenRouter and Ollama
— pick a model in a menu, and you are coding.

> Nexus Switch is **not affiliated with Anthropic**. It launches the `claude` CLI you install yourself.

## Why Nexus Switch

**Zero config.** No config file, no Python proxy, no background daemon, no edits to your shell
profile. Nexus translates Claude Code's requests for each provider inside its own process, only
while `claude` runs, and stops when you quit.

**No surprise bills.** Every model is labelled before you launch it — and the highlighted one is
explained in plain words:

| Label | Meaning |
|---|---|
| **`FREE`** | Runs on your machine. No account, never billed. |
| **`QUOTA`** | Free provider account. Free up to a usage quota, then blocked or billed. |
| **`PAID`** | Billed per token from the first request. |
| **`UPGRADE`** | Needs a paid subscription first (e.g. some Ollama cloud models fail on a free account). |

Models are sorted cheapest first, and the catalog is checked against each provider's live API.
When a free quota cannot carry Claude Code's full prompt (Groq: 8,000 tokens/min), nexus switches
to reduced mode on its own instead of letting every request fail.

**You know where your code goes.** Claude Code sends the model what it reads: your files, your
command output. Under each model, nexus shows what that provider does with it, from its own terms
(for example: Gemini's free tier may use it to improve Google's products, Mistral's free plan
trains on it unless you opt out). Local Ollama models never send it anywhere.

**Free quota ran out? Opt in to fallback.** Free tiers run dry fast under Claude Code. Turn on
`nexus chain auto` and, when the provider you picked is rate limited or down, nexus serves the
request from another provider you have a key for — same class of model, **never a paid one** —
then goes back to your pick. It is **off by default**: turning it on first lists every provider
your code could reach and what each does with it, and asks you to confirm.

**Keys stay safe.** API keys live in `~/.nexus-switch`, encrypted with Windows DPAPI, or in an
owner-only file (`0600`) on macOS and Linux. They are never written to your global environment.
For Groq, Gemini, Mistral, Cerebras and NVIDIA the key never leaves the nexus process: `claude`
only gets a one-session token for nexus' local endpoint.

**Works on Windows.** npm's `claude.cmd`, the native `claude.exe`, PowerShell and Git Bash are
all handled, and end-to-end tests drive a real terminal on Windows and Linux.

## Install

```bash
npm i -g @hexanexus/nexus-switch
nexus doctor          # checks that claude and your keys are ready
```

**Requires** Node.js ≥ 18 and [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code).
No Claude Code yet? Nexus offers to install it on first launch.

## Quick start

```bash
nexus                 # menu: pick a provider, then a model
nexus groq            # launch straight on Groq
nexus ollama          # local or cloud Ollama model
nexus openrouter      # OpenRouter free models
```

The first launch on a provider asks for its API key once (free account, no card for most
providers — the links are in [docs/PROVIDERS.md](docs/PROVIDERS.md)). When `claude` exits you
are back in the menu, not in the shell.

```text
 ◢ NEXUS SWITCH  ·  AI model router · HexaNexus

 Groq  ·  3 models
 ────────────────────────────────────────────────────
 ▸ ● QUOTA   GPT-OSS 120B  cloud · 131K · $0.15/0.6
   ● QUOTA   GPT-OSS 20B   cloud · 131K · $0.075/0.3
   ● QUOTA   Qwen3.8 27B   cloud · 131K

 ▍ Free up to the quota (free groq account required) — beyond it: $0.15 in / $0.6 out per M tokens.
   production, reasoning + tools — free account required (console.groq.com)
   Data: Not retained by default; logs kept up to 30 days for abuse checks. Training not
 addressed on its data page.

 ↑↓ navigate · ⏎ launch · ← providers · q quit
```

## Providers

| Provider | Free tier | What it does with your code (official terms, checked 2026-11-26) | Setup |
|---|---|---|---|
| **Groq** | 8k tokens/min | Not retained by default; abuse logs up to 30 days. Training not addressed. [Terms](https://console.groq.com/docs/your-data) | `nexus key set groq <key>` · reduced mode |
| **Gemini** | Yes | May be used to improve Google products, human reviewers may read it — except in the EEA, UK and Switzerland. [Terms](https://aistudio.google.com/docs/terms) | `nexus key set gemini <key>` |
| **Mistral** | Free plan | Trains Mistral models by default; opt out in admin.mistral.ai > Privacy. [Terms](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) | `nexus key set mistral <key>` |
| **NVIDIA NIM** | Trial, rate-limited, **not for production** | May be used, de-identified, to improve NVIDIA models. [Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) | `nexus key set nvidia <key>` |
| **OpenRouter** | `:free` models, 50 requests/day | Depends on the host; refuse hosts that train in your [privacy settings](https://openrouter.ai/docs/guides/privacy/provider-logging). | `nexus key set openrouter <key>` |
| **Ollama local** | Unlimited | Runs on your machine — nothing leaves it. | `ollama pull <model>` |
| **Ollama cloud** | Quota (some models Pro-only) | Not checked by nexus yet. | `ollama signin` |
| **Cerebras** | **None** — card required, one-time $5 credit (30 days) | Inputs and outputs not retained. [Terms](https://www.cerebras.ai/privacy-policy) | `nexus key set cerebras <key>` |
| **Anthropic** | — (paid) | Your Anthropic plan's terms. | Claude subscription or `ANTHROPIC_API_KEY` |

Free tiers and terms change often: nexus dates every entry, and `nexus credits` shows what is
left where the provider exposes it. Do not send secrets or personal data to a provider whose
terms you have not read.

## Commands

```bash
nexus                             # menu (provider → model → launch)
nexus <provider> [model] [-- claude flags]   # direct launch, e.g. nexus groq -- -p "hi"
nexus key set <provider> <key>    # save a provider API key
nexus key list                    # which keys are configured
nexus key delete <provider>       # remove a key
nexus doctor                      # check claude and keys
nexus credits                     # remaining credits/quota per provider
nexus chain                       # is fallback on? (off by default)
nexus chain auto                  # turn fallback on, automatic order (asks you to confirm)
nexus chain set groq gemini       # turn fallback on, your own order (asks you to confirm)
nexus chain off                   # turn fallback off
nexus refresh                     # refresh the OpenRouter + Ollama model lists
nexus report                      # report a problem (pre-filled GitHub issue)
nexus update                      # update nexus-switch
nexus uninstall                   # remove nexus and every key it stored
nexus help                        # every command and environment variable (-h, --help)
nexus version                     # installed version (-v, --version)
```

A mistyped command or provider gets a suggestion (`nexus groc` → did you mean `nexus groq`?);
in a terminal, answering `y` runs it.

- **Language** — English, or French when your system language is French. Force one with
  `NEXUS_LANG=en` or `NEXUS_LANG=fr`.
- **Updates** — nexus checks npm at most once a day and shows `↑ X.Y.Z available · nexus update`.
  It never updates itself. `NEXUS_NO_UPDATE_CHECK=1` turns the check off.
- **Fallback** — off by default. Once on, it works between Gemini, NVIDIA, Mistral and Groq
  (the free providers nexus translates for), in that order. `NEXUS_NO_FALLBACK=1` turns it off
  for one session; `--yes` confirms `nexus chain` outside an interactive terminal.
- **Full prompt on Groq** — on a paid Groq tier, `NEXUS_FULL_PROMPT=1` turns reduced mode off.

## Reporting a problem

Run `nexus report` (or press `r` in the menu). It prints a diagnostic — OS, Node, shell, how
`claude` is installed, which providers have a key (yes/no, never the key itself), the state of the
key store and the last lines of nexus' own logs — with every API key and your user folder masked,
then opens a pre-filled GitHub issue. Nothing is sent until you read it and click *Submit*.

## When to use something else

Nexus Switch does one thing: get Claude Code running on free and cheap models with nothing to
configure. Pick another tool when you need more than that:

- **Routing rules, several API keys per provider, other coding agents (Codex, OpenCode…), a web
  dashboard** → [claude-code-router](https://github.com/musistudio/claude-code-router).
- **The best results on large or delicate codebases** → a Claude subscription. Claude Code is tuned
  for Claude models; free open-weight models are good, but not as good.

## How it works

For OpenAI-compatible providers, nexus starts a small HTTP server on `127.0.0.1` (random port,
per-session token) right before launching `claude`, points Claude Code at it, translates each
request Anthropic ⇄ OpenAI and forwards only the fields the provider understands. OpenRouter,
Ollama and Anthropic speak Claude Code's protocol natively, so nexus only sets their environment.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Legal

Nexus Switch is an independent open-source project, **not affiliated with or endorsed by Anthropic, Google, Mistral, or any other provider**. "Claude" and "Claude Code" are trademarks of Anthropic, PBC, referenced here solely to describe interoperability. Nexus Switch does not bundle or redistribute Claude Code — it launches the `claude` CLI you install separately. You are responsible for complying with each provider's terms of service. See [NOTICE](NOTICE).

## License

MIT — see [LICENSE](LICENSE).
