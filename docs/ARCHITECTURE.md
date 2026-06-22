# Architecture

Nexus Switch is a **cross-platform** terminal launcher/router for Claude Code.
It runs anywhere the `claude` CLI runs (Windows, macOS, Linux) as a single
Node/TypeScript codebase. The terminal UI is rendered with Ink (React for the
terminal) — it stays a keyboard-driven TUI, not a web app.

> Current architecture (`1.1.x`). The `0.2.x` line is the legacy PowerShell
> implementation it replaced. See [Migration](#migration-from-02x).

## Runtime flow

```text
User terminal
  -> nexus (Ink TUI)            interactive provider/model selection
  -> core/providers            load + validate providers/*.json
  -> core/secrets              resolve provider key + proxy master key from the store
  -> core/env                  reset, then set ANTHROPIC_* on the process
  -> core/launch               spawn claude (or `ollama launch claude`)
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

## Module layout

```text
src/
  core/
    providers.ts        load + validate providers/*.json (typed)
    secrets.ts          per-user secret store (~/.nexus-switch); DPAPI/plaintext; legacy-env migration
    keys.ts             provider -> secret name map; reads/writes via the store
    env.ts              reset + resolve ANTHROPIC_* template and model rules before launch
    launch.ts           unified pipeline: reset env, branch ollama/claude, spawn
    proxy.ts            LiteLLM gateway lifecycle; secrets injected only into the child
    litellm-config.ts   generate the gateway YAML from providers + present keys
    catalog.ts          refresh model lists live from provider APIs
    doctor.ts           diagnostics + provider key validation
  ui/
    App.tsx        Ink TUI root
    ProviderList.tsx
    ModelPicker.tsx
  types/
    provider.types.ts
bin/nexus.js       entrypoint (boots Ink for the bare `nexus` command)
providers/*.json   provider + model catalog (single source of truth)
```

## Secret storage

Provider keys and the proxy master key live in a per-user store at
`~/.nexus-switch/` — never in global environment variables, never in the repo.
They are injected **only** into the spawned child (the `claude` process, or the
LiteLLM gateway), so no other process inherits them.

```text
win32        -> DPAPI (CurrentUser) encrypted blob; fallback plaintext + owner-only ACL (icacls)
darwin/linux -> plaintext file, chmod 0600, inside a 0700 directory
```

On first run, any key still in a legacy global env var (pre-1.1 users) is
migrated into the store and purged from the environment — transparently.

## Command surface

`nexus` is an npm global bin — **no shell profile injection**. Former shell
functions become subcommands, so there is zero profile pollution on any OS.

| Command | Purpose |
|---|---|
| `nexus` | interactive TUI |
| `nexus <provider> [model] [--flags]` | direct launch |
| `nexus doctor` | diagnostics (claude present, key validity, proxy) |
| `nexus refresh` | refresh model catalog from provider APIs |
| `nexus key set <provider> <key>` | persist a provider key (replaces `claude-set-key`) |
| `nexus key list` | list configured keys (masked) |
| `nexus proxy start` / `nexus proxy stop` | manage the LiteLLM gateway |
| `nexus credits` | provider credit/status |
| `nexus update` / `nexus uninstall` | lifecycle |

## Design rules

- **`claude` CLI is a hard dependency, not a provider.** Providers (OpenRouter,
  Groq, Ollama, LiteLLM) are token backends; `claude` is the agent itself. Every
  path terminates in `claude` (the Ollama path runs `ollama launch claude`).
  `core/launch` guards on a `claude` pre-flight and offers an opt-in install if absent.
- One terminal = one active provider context.
- No global `settings.local.json` routing state.
- No shell profile injection — `nexus` is a self-contained bin.
- Provider/model catalog lives in `providers/*.json`; refreshable via `nexus refresh`.
- Secrets live in a per-user store (`~/.nexus-switch`, DPAPI/0600), injected only into the child — never global env, never in the repo.
- LiteLLM is an optional local gateway, not bundled; its config is generated from the provider JSONs + present keys (no committed YAML).
- The LiteLLM gateway is locked with an auto-generated master key (`NEXUS_PROXY_KEY`); it is not a provider credential.
- TypeScript strict; provider types in `src/types/`.

## Extension points

- Add a provider JSON file (LiteLLM gateway entries are generated from it automatically).
- Add a key mapping in `core/keys` (`KEY_VARS`) if a new secret variable is needed.

## Migration from 0.2.x

The `0.2.x` line is a single PowerShell script (`src/NexusSwitch.ps1`) injected
into the user's PS profile, Windows-only. `1.0.0` replaces it with the Node/TS
modules above. Breaking changes: drops the PowerShell entrypoint, and
`claude-set-key` / `claude-proxy-start` become `nexus key set` / `nexus proxy start`.
