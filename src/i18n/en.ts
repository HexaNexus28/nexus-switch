// English messages — the source of truth. Every other locale must provide the
// exact same shape (enforced by the `Messages` type), so a key missing from a
// translation fails the build instead of showing an empty string.

const CLAUDE_INSTALL = 'npm i -g @anthropic-ai/claude-code';

export const en = {
  header: {
    update: (version: string) => `  ↑ ${version} available · nexus update`,
  },
  providers: {
    subtitle: '  ·  pick your model source',
    none: 'No valid provider in providers/.',
    noneFatal: 'No valid provider in providers/. Fix the catalog and run again.',
    models: (n: number) => `${n} models`,
    bestFree: 'free',
    bestQuota: 'free quota',
    bestPaid: 'paid',
    bestSubscription: 'subscription',
    reduced: ' · reduced mode',
    hint: '↑↓ navigate · ⏎ select · r report a problem · q quit',
  },
  picker: {
    badge: { free: 'FREE', quota: 'QUOTA', paid: 'PAID', subscription: 'UPGRADE' },
    accountNamed: (name: string) => `free ${name} account required`,
    accountGeneric: 'free account required',
    pricePerMillion: (pin: number, pout: number | string) => `$${pin} in / $${pout} out per M tokens`,
    costFree: 'Free — runs on your machine, no account, never billed.',
    costQuota: (account: string, beyond: string) => `Free up to the quota (${account}) — beyond it: ${beyond}.`,
    quotaBeyondDefault: 'blocked until reset, or a paid plan',
    costPaid: (price: string) => `Paid from the first request — ${price}.`,
    paidDefault: "see the provider's pricing",
    costSubscription: 'Paid subscription REQUIRED before use — does not work on a free account.',
    hint: '↑↓ navigate · ⏎ launch · ← providers · q quit',
    data: (summary: string) => `Data: ${summary}`,
    dataLocal: 'Data: runs on your machine, your code never leaves it.',
    dataUnknown: "Data: not checked by nexus yet — read the provider's terms before sending private code.",
  },
  confirm: {
    hint: 'y = yes · n / Enter / Esc = no',
  },
  keyPrompt: {
    title: (provider: string, varName: string) => `${provider} API key missing (${varName})`,
    body: 'Paste your key — it is stored in ~/.nexus-switch, never in the global environment.',
    placeholder: '(paste here)',
    hint: 'Enter to confirm · Esc / empty Enter to cancel',
  },
  dialogs: {
    claudeMissingTitle: 'Claude Code CLI not found',
    claudeMissingMessage: 'Nexus launches Claude Code, so it must be installed. Install it now with npm?',
    modelMissingTitle: 'Model not downloaded',
    modelMissingMessage: (model: string) => `'${model}' is not on your machine. Download it now? It can take several GB.`,
  },
  setup: {
    claudeMissing: 'Claude Code CLI not found. Nexus launches Claude Code; it is not an agent on its own.',
    claudeInstallHint: `Install: ${CLAUDE_INSTALL}`,
    claudeInstallAsk: 'Install it now with npm? [y/N] ',
    claudeInstallAborted: `Cancelled. Install it manually: ${CLAUDE_INSTALL}`,
    claudeInstallFailed: 'Claude Code installation failed.',
    ollamaMissing: (model: string) => `Ollama model '${model}' is not installed locally.`,
    ollamaPullHint: (model: string) => `Download it: ollama pull ${model}`,
    ollamaPullAsk: (model: string) => `Download it now with 'ollama pull ${model}'? It can be large (several GB). [y/N] `,
    ollamaPullAborted: (model: string) => `Cancelled. Download it: ollama pull ${model}`,
    ollamaPullFailed: (model: string) => `Pulling '${model}' failed.`,
    keyMissing: (provider: string, varName: string) => `API key missing for ${provider} (${varName}).`,
    keySetHint: (provider: string) => `Set it: nexus key set ${provider} <key>`,
    keyAsk: (provider: string) => `Paste your ${provider} key now (Enter to cancel): `,
    keyAborted: (provider: string) => `Cancelled. Set it: nexus key set ${provider} <key>`,
    keySaved: (varName: string) => `${varName} saved in ~/.nexus-switch.`,
  },
  cli: {
    keyValid: 'valid',
    keyRejected: 'key rejected',
    keyPresent: 'present',
    keyAbsent: 'missing',
    refreshOpenRouter: (kept: number, removed: number, tail: string) =>
      `OpenRouter: ${kept} models kept, ${removed} removed${tail}`,
    refreshOllama: (n: number) => `Ollama    : ${n} models (from ollama list)`,
    skipped: 'skipped',
    unsupportedProvider: (provider: string) => `Unsupported provider: ${provider}`,
    keyDeleted: (varName: string) => `${varName} removed from ~/.nexus-switch.`,
    keyUsage: 'Usage: nexus key set <provider> <key> | nexus key list | nexus key delete <provider>',
    unknownProvider: (name: string, available: string) => `Unknown provider: ${name}. Available: ${available}`,
    updateAvailable: (version: string) => `nexus ${version} available -> nexus update`,
    creditsKeyPresent: 'key present',
    creditsOllama: 'Ollama     : local unlimited · cloud quota (https://ollama.com/dashboard)',
    uninstalled: 'Secrets and config removed (~/.nexus-switch + global env purged).',
  },
  credits: {
    keyMissing: 'key missing',
    providerNotFound: 'provider not found',
    noCreditsApi: 'no credits_api',
    remaining: (left: string, used: string, total: string) => `${left} left (used ${used} / ${total})`,
    unreachable: 'unreachable',
  },
  catalog: {
    openRouterEmpty: 'OpenRouter: empty model list, catalog unchanged.',
    openRouterNoneLeft: 'OpenRouter: no local model survives, catalog unchanged.',
    ollamaListFailed: '`ollama list` failed (is ollama installed?)',
    ollamaNone: 'no launchable Ollama model (catalog unchanged)',
    invalidProvider: (reason: string) => `Provider skipped (invalid catalog): ${reason}`,
  },
  launch: {
    keyMissing: (provider: string) => `API key missing for ${provider}. Set it: nexus key set ${provider} <key>`,
    gatewayFailed: (url: string, reason: string) => `Gateway unavailable (${url}): ${reason}`,
    ollamaSubscription:
      "Model reserved to Ollama Pro/Max subscribers — on a free account, Claude Code will get a 403 'requires a subscription' error.\n" +
      'Upgrade: ollama.com/upgrade · free with a quota: minimax-m3:cloud, qwen3-coder:480b-cloud, gpt-oss:120b-cloud',
    ollamaCloud:
      'Ollama cloud model — account required (free, no card): ollama.com\n' +
      'Run `ollama signin` if you have not yet.\n' +
      'Free quota: resets every 5h + weekly, 1 concurrent model.\n' +
      'To lift the limits: Pro $20/month · Max $100/month -> ollama.com/pricing',
    ollamaLocal:
      "Local Ollama model: a large context needs a lot of RAM/VRAM. On 'out of memory' -> switch to a :cloud model, or lower OLLAMA_CONTEXT_LENGTH (e.g. 16384) and restart Ollama.",
    ollamaFailed: (reason: string) => `ollama failed: ${reason}`,
    ollamaExited: (code: number | null, model: string) =>
      `ollama exited (code ${code}). Does model '${model}' exist? -> ollama list`,
    claudeNotFound: 'claude failed: not found on PATH.',
    claudeFailed: (reason: string) => `claude failed: ${reason}`,
    bare: (provider: string) =>
      `${provider}: reduced mode (--bare, no CLAUDE.md/MCP/hooks), the free quota cannot carry the full prompt.\n` +
      'Paid tier? NEXUS_FULL_PROMPT=1 turns it off.',
  },
  gateway: {
    quotaHint:
      'nexus: request larger than the provider tokens-per-minute quota. ' +
      'Relaunch with `-- --bare` (reduced prompt), pick another provider, or move to the paid tier.',
    providerUnreachable: (url: string, reason: string) => `Provider unreachable (${url}): ${reason}`,
  },
  fallback: {
    chain: (names: string[]) => `Fallback if quota runs out: ${names.join(' -> ')}`,
    summary: (from: string, to: string, n: number) =>
      `${from} unavailable ${n}x (quota or outage) -> served by ${to}.`,
    manualSet: (names: string) => `Fallback on, in this order: ${names}`,
    autoSet: 'Fallback on: automatic order, same model class, never a paid model.',
    offSet: 'Fallback off: your code only goes to the provider you pick.',
    showOff: 'Fallback: off (default). Your code only goes to the provider you pick. Turn it on: nexus chain auto',
    showManual: (names: string) => `Fallback: on, in this order: ${names}`,
    showAuto: 'Fallback: on, automatic order — providers with a key, same model class, never a paid model.',
    consentIntro: 'When the provider you picked is out of quota, fallback sends the request — your code included — to:',
    consentFooter: 'Only providers you have a key for are used, and never a paid model. Turn it off any time: nexus chain off',
    policyUnknown: 'data policy not checked by nexus yet',
    noneUsable: 'None of these providers has a free or quota model that can stand in: fallback unchanged.',
    confirm: 'Turn fallback on? [y/N] ',
    needYes: 'Not an interactive terminal: add --yes to confirm.',
    cancelled: 'Fallback unchanged.',
    suggest: (provider: string, n: number) =>
      `${provider} hit its quota ${n}x this session. Fallback to your other providers is off — see: nexus chain auto`,
    notGateway: (id: string) => `${id} cannot be a fallback (only Groq, Gemini, Cerebras, Mistral, NVIDIA can).`,
    usage: 'Usage: nexus chain | nexus chain auto | nexus chain set <provider>... | nexus chain off  (--yes outside a terminal)',
  },
  report: {
    header: 'Diagnostic (API keys and your user folder are masked):',
    opening: 'Opening a pre-filled GitHub issue in your browser.',
    nothingSent: 'Nothing is sent until you read it and click "Submit new issue". Describe what you did above it.',
    link: (url: string) => `If the browser did not open:\n${url}`,
  },
  secrets: {
    refuseWipe: (dir: string) => `Refusing to delete ${dir}: directory too broad.`,
  },
};

export type Messages = typeof en;
