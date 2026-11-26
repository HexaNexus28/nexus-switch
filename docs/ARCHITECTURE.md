# Architecture

Nexus Switch is a **cross-platform** terminal launcher/router for Claude Code.
It runs anywhere the `claude` CLI runs (Windows, macOS, Linux) as a single
Node/TypeScript codebase. The terminal UI is rendered with Ink (React for the
terminal) — it stays a keyboard-driven TUI, not a web app.

## Runtime flow

```text
User terminal
  -> nexus (Ink TUI)            interactive provider/model selection
  -> core/providers             load + validate providers/*.json
  -> core/keys + core/secrets   resolve the provider key from the store
  -> core/env                   reset, then set ANTHROPIC_* on the process
  -> core/launch                spawn claude (or `ollama launch claude`)
  -> back to the TUI picker     when claude exits or a prerequisite fails (hub loop)
```

For `gateway`-typed providers (Groq, Gemini, Cerebras, Mistral, NVIDIA NIM):

```text
Claude Code
  -> ANTHROPIC_BASE_URL=http://127.0.0.1:<ephemeral port>
  -> gateway/server.ts          in-process loopback HTTP server
       translate.ts             Anthropic /v1/messages <-> OpenAI /chat/completions
       stream.ts                OpenAI SSE -> Anthropic SSE
  -> provider's OpenAI-compatible endpoint
```

The gateway binds an ephemeral loopback port and uses a per-session random
bearer token. The provider API key lives only inside the Nexus process and is
injected into the upstream `Authorization` header; it is never written to the
child's environment.

For OpenRouter, Claude Code talks to OpenRouter's Anthropic-compatible endpoint
directly (`providers/openrouter.json` `env` template). For Ollama, Nexus runs
`ollama launch claude --model <model>`.

## Model aliases and background work

Claude Code resolves its `haiku` model (used for titles, summaries and other
background work) from `ANTHROPIC_DEFAULT_HAIKU_MODEL`, and `/model` aliases from
the other `ANTHROPIC_DEFAULT_*_MODEL` variables. A third-party provider serves
none of the Anthropic model ids, so for non-Anthropic providers Nexus points
every alias at the selected model. Without this, a background request for
`claude-haiku-*` reaches Groq/Gemini/... and 404s.

Same for the context window: Claude Code assumes 1M tokens for an unknown model
id, so it never auto-compacts before the provider's real limit. Nexus exports
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the catalog's `context` (unset when the
catalog has none; never for native Anthropic).

## TUI invariant

Everything that READS stdin lives inside Ink (picker, `[o/N]` dialogs, key
input). A readline prompt after an Ink teardown loses keystrokes on Windows
(cancelled raw console read), so readline prompts exist only on the direct CLI
path (`nexus <provider>`), where Ink never ran. Console-bound actions (npm
installs, ollama pull, claude itself) run BETWEEN Ink sessions with an inherited
terminal.

## Module layout

```text
src/
  core/
    providers.ts        load + validate providers/*.json (typed)
    secrets.ts          per-user secret store (~/.nexus-switch); DPAPI/plaintext
    keys.ts             provider -> secret name map
    env.ts              reset + resolve ANTHROPIC_* and model alias variables
    launch.ts           unified pipeline; resolves claude.exe / claude.cmd
    catalog.ts          refresh model lists from provider APIs
    credits.ts          OpenRouter balance + key presence
    doctor.ts           diagnostics + key validation
    update.ts           daily npm check (cached), "newer version" notice; never self-installs
    package-info.ts     version + issues URL from the shipped package.json
    chain.ts            fallback routes: same model class, free/quota only, manual chain or fallback_order
    config.ts           ~/.nexus-switch/config.json (preferences, e.g. the manual fallback chain)
    report.ts           `nexus report`: redacted diagnostic -> pre-filled GitHub issue (nothing sent by nexus)
  i18n/
    en.ts               every user-facing string (source of truth, defines the Messages type)
    fr.ts               French; must match en.ts key for key (compile-time check)
    index.ts            locale: NEXUS_LANG > LC_ALL/LC_MESSAGES/LANG (not on Windows) > Intl; default en
  gateway/
    server.ts           loopback HTTP server, auth, SSE/JSON responses; tries routes in order
    router.ts           pure fallback decisions: which statuses switch, Retry-After cooldowns, route order
    translate.ts        Anthropic <-> OpenAI request/response translation
    stream.ts           OpenAI SSE -> Anthropic SSE, usage extraction
  ui/
    App.tsx             Ink TUI root and prerequisite chain
    ProviderList.tsx
    ModelPicker.tsx
    KeyPrompt.tsx
    Confirm.tsx
    Header.tsx
  types/
    provider.types.ts
    gateway.types.ts
    i18n.types.ts
    report.types.ts
bin/nexus.js            entrypoint (boots Ink for the bare `nexus` command)
providers/*.json        provider + model catalog (single source of truth)
```

## Launcher resolution

On Windows, npm installs `claude` as a `.cmd` shim, which Node's `spawn` cannot
execute directly. `resolveClaude()` resolves the command once: it prefers a
native `claude.exe`, then runs the shim's `cli.js` through `node`, and only
falls back to `cmd.exe /d /s /c` for unusual layouts. Detection
(`claudeExists`) and launch (`runClaude`) share that resolution, so a shim
cannot be "present" for one and "missing" for the other.

## Secret storage

Provider keys live in a per-user store at `~/.nexus-switch/` — never in global
environment variables, never in the repo. They are injected only into the
gateway process, which forwards them upstream.

```text
win32        -> DPAPI (CurrentUser) encrypted blob; fallback plaintext + owner-only ACL (icacls)
darwin/linux -> plaintext file, chmod 0600, inside a 0700 directory
```

Writes are atomic (`.tmp` + rename). If a store cannot be decoded, it is kept as
`secrets.json.corrupt-<timestamp>` before a new store is written, and the error
is logged to `secrets-errors.log` rather than silently reported as "no keys".
`NEXUS_DATA_DIR` overrides the directory; `wipeSecretStore` refuses to delete a
filesystem root or the user's home directory.

## Command surface

| Command | Purpose |
|---|---|
| `nexus` | interactive TUI |
| `nexus <provider> [model] [-- claude flags]` | direct launch |
| `nexus doctor` | diagnostics (claude present, key validity) |
| `nexus refresh` | refresh OpenRouter + Ollama catalogs |
| `nexus key set <provider> <key>` | persist a provider key |
| `nexus key list` | list configured keys |
| `nexus key delete <provider>` | remove a provider key |
| `nexus credits` | provider credit/status |
| `nexus update` / `nexus uninstall` | lifecycle |

## Design rules

- **`claude` CLI is a hard dependency, not a provider.** Every path terminates in
  `claude` (the Ollama path runs `ollama launch claude`).
- One terminal = one active provider context.
- No global `settings.local.json` routing state and no shell profile injection.
- Provider/model catalog lives in `providers/*.json`; refreshable via `nexus refresh`.
- Secrets live in `~/.nexus-switch`, injected only into the gateway — never the
  global env, never the repo.
- The gateway is in-process: it must never block the event loop while claude is
  running (hence `spawn`, not `spawnSync`).
- TypeScript strict; provider/wire types live in `src/types/`.

## Extension points

- Add a provider JSON file.
- Add a key mapping in `core/keys` (`KEY_VARS`) if a new secret variable is needed.
- Add a provider to `src/core/credits.ts` if it exposes a status endpoint.
