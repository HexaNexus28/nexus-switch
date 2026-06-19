# Architecture

Nexus Switch is a **cross-platform** terminal launcher/router for Claude Code.
It runs anywhere the `claude` CLI runs (Windows, macOS, Linux) as a single
Node/TypeScript codebase. The terminal UI is rendered with Ink (React for the
terminal) — it stays a keyboard-driven TUI, not a web app.

> Target architecture for `1.0.0`. The `0.2.x` line is the legacy PowerShell
> implementation being replaced. See [Migration](#migration-from-02x).

## Runtime flow

```text
User terminal
  -> nexus (Ink TUI)            interactive provider/model selection
  -> core/providers            load + validate providers/*.json
  -> core/env                  set ANTHROPIC_* on the process
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
    providers.ts   load + validate providers/*.json (typed)
    env.ts         apply ANTHROPIC_* to the current process before launch
    launch.ts      spawn claude / ollama; pre-flight ensures claude exists
    catalog.ts     refresh model lists live from provider APIs
    doctor.ts      diagnostics + provider key validation
  platform/
    persist.ts     OS-specific key persistence (the only platform-specific code)
  ui/
    App.tsx        Ink TUI root
    ProviderList.tsx
    ModelPicker.tsx
  types/
    provider.types.ts
bin/nexus.js       entrypoint (boots Ink for the bare `nexus` command)
providers/*.json   provider + model catalog (unchanged)
litellm/           optional local gateway config (unchanged)
```

## Platform abstraction

The only code that branches on OS is `platform/persist.ts` — where provider
keys are stored. Everything else (provider loading, routing, doctor, catalog,
launch) is portable as-is.

```text
win32        -> User environment variable (registry), persists across terminals
darwin/linux -> export line appended to the detected shell rc (~/.zshrc, ~/.bashrc, fish)
```

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
- Secrets live in OS-native storage (env var on Windows, shell rc on Unix), never in the repo.
- LiteLLM is an optional local gateway, not bundled.
- TypeScript strict; provider types in `src/types/`.

## Extension points

- Add a provider JSON file.
- Add matching LiteLLM entries if provider type is `litellm`.
- Add a key mapping in `core/providers` if a new secret variable is needed.

## Migration from 0.2.x

The `0.2.x` line is a single PowerShell script (`src/NexusSwitch.ps1`) injected
into the user's PS profile, Windows-only. `1.0.0` replaces it with the Node/TS
modules above. Breaking changes: drops the PowerShell entrypoint, and
`claude-set-key` / `claude-proxy-start` become `nexus key set` / `nexus proxy start`.
