# Providers

Keys are persisted with `nexus key set <provider> <key>` into a per-user store at
`~/.nexus-switch/` — DPAPI-encrypted on Windows (fallback owner-only file), and a
`0600` file on macOS/Linux. They never become global environment variables and are
injected only into the in-process gateway.

```bash
nexus key list
nexus key delete <provider>
```

## Gateway providers

These providers expose an OpenAI-compatible `/chat/completions` endpoint. Nexus
starts a loopback gateway in its own process, translates Anthropic
`/v1/messages` to OpenAI chat completions, and points `claude` at it.

| Provider | Key variable | Command |
|---|---|---|
| Groq | `GROQ_API_KEY` | `nexus key set groq ...` |
| Gemini | `GEMINI_API_KEY` | `nexus key set gemini ...` |
| Cerebras | `CEREBRAS_API_KEY` | `nexus key set cerebras ...` |
| Mistral | `MISTRAL_API_KEY` | `nexus key set mistral ...` |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `nexus key set nvidia ...` |

```bash
nexus groq
nexus gemini
nexus cerebras
nexus mistral
nexus nvidia
```

### Groq: reduced mode (`--bare`)

Groq's free tier allows 8000 tokens/minute per model (measured 2026-11-25 on every
chat model). A full Claude Code request is 24-37k tokens, so Groq answers 413 on the
first message. `providers/groq.json` sets `"bare": true`: Nexus launches claude with
`--bare` (no CLAUDE.md, hooks, MCP or plugins), which fits the quota. On a paid
(Dev) tier, opt out with `NEXUS_FULL_PROMPT=1`.

Any provider 413 is relayed as a 400 with the provider's own message plus a hint:
Claude Code renders a raw 413 as "max 32MB / images", which hides the real cause.

The gateway is created when claude starts and closed when it exits; there is no
long-lived proxy to start/stop and no port 4000 dependency.

### Auto mode behind the gateway

Claude Code's auto mode now expects Anthropic's servers to run its permission
checks inside each model request (`safeguards` in, `safeguard_results` out). A
translating gateway can never provide them: Groq, Gemini & co. are not Anthropic
servers. Without a hint, Claude Code holds the first checked action behind a
billing notice. Nexus sets `CLAUDE_CODE_AUTO_MODE_SERVER=0` for gateway sessions,
so Claude Code makes its own classifier requests — they reach the gateway and
are served by the picked free model like any other request. Anthropic documents
this variable as temporary
([auto-mode classifier billing](https://code.claude.com/docs/en/auto-mode-classifier-billing)):
re-check it when Claude Code changes.

### Fallback between gateway providers

When the picked provider answers 429, 413, 502, 503, 504, 529 or cannot be
reached, and the response has not started yet, the gateway retries the request on
the next route. Once SSE bytes are on the wire it never switches: the failure
becomes a stream error.

Catalog fields that drive it:

| Field | Where | Meaning |
|---|---|---|
| `class` | model | `large` or `fast`; a model only falls back to the same class. No class = no fallback. |
| `fallback_order` | provider | Rank in the automatic chain (Gemini 2, NVIDIA 3, Mistral 4, Groq 5). Cerebras has none: no permanent free tier (official FAQ, checked 2026-11-26). |
| `max_request_tokens` | provider | Groq: 8000. Bigger requests skip this provider as a fallback. |

Only `free` and `quota` models are ever picked; on each fallback provider its
`default` model is preferred when it has the right class. A failing route is put
aside for its `Retry-After` window (60 s by default, 15 min max; none for 413,
since smaller requests may still fit), then the picked provider is used again.
`nexus chain set <provider>...` replaces the automatic order (stored in
`~/.nexus-switch/config.json`); `NEXUS_NO_FALLBACK=1` disables fallback.

## OpenRouter

Key variable: `OPENROUTER_API_KEY`

```bash
nexus key set openrouter sk-or-...
nexus openrouter
```

OpenRouter exposes an Anthropic-compatible endpoint, so Claude Code talks to it
directly without the translation gateway.

## Ollama

Ollama is launched via:

```bash
ollama launch claude --model <model>
```

No API key is stored by Nexus Switch for local models. `:cloud` models require an
Ollama sign-in. `nexus refresh` rebuilds the Ollama catalog from `ollama list`.

## Anthropic

Anthropic is used natively: Nexus does not store an Anthropic key. Either be
logged in with a Claude subscription, or export `ANTHROPIC_API_KEY` before
launching. The TUI/CLI model picker still selects the model passed as
`ANTHROPIC_MODEL`.

## Background model aliases

For every non-Anthropic provider, Nexus sets `ANTHROPIC_DEFAULT_HAIKU_MODEL`
(plus the Sonnet/Opus/Fable aliases) to the selected model. Claude Code uses the
haiku alias for background work such as titles and summaries; without the
mapping those requests would be sent to an Anthropic model id the provider does
not serve.
