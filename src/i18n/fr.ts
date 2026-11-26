import type { Messages } from './en.js';

const CLAUDE_INSTALL = 'npm i -g @anthropic-ai/claude-code';

export const fr: Messages = {
  header: {
    update: (version) => `  ↑ ${version} dispo · nexus update`,
  },
  providers: {
    subtitle: '  ·  choisis ta source de modèles',
    none: 'Aucun provider valide dans providers/.',
    noneFatal: 'Aucun provider valide dans providers/. Corrige le catalogue puis relance.',
    models: (n) => `${n} modèles`,
    bestFree: 'gratuit',
    bestQuota: 'quota gratuit',
    bestPaid: 'payant',
    bestSubscription: 'abonnement',
    reduced: ' · mode réduit',
    hint: '↑↓ naviguer · ⏎ choisir · q quitter',
  },
  picker: {
    badge: { free: 'GRATUIT', quota: 'QUOTA', paid: 'PAYANT', subscription: 'UPGRADE' },
    accountNamed: (name) => `compte ${name} gratuit requis`,
    accountGeneric: 'compte gratuit requis',
    pricePerMillion: (pin, pout) => `$${pin} in / $${pout} out par M tokens`,
    costFree: 'Gratuit — tourne sur ta machine, aucun compte, aucune facturation.',
    costQuota: (account, beyond) => `Gratuit jusqu'au quota (${account}) — au-delà : ${beyond}.`,
    quotaBeyondDefault: "bloqué jusqu'au reset, ou plan payant",
    costPaid: (price) => `Payant dès la première requête — ${price}.`,
    paidDefault: 'voir la grille du provider',
    costSubscription: 'Abonnement payant OBLIGATOIRE avant usage — ne fonctionne pas avec un compte gratuit.',
    hint: '↑↓ naviguer · ⏎ lancer · ← providers · q quitter',
  },
  confirm: {
    hint: 'o = oui · n / Entrée / Échap = non',
  },
  keyPrompt: {
    title: (provider, varName) => `Clé API ${provider} absente (${varName})`,
    body: "Colle ta clé — elle sera stockée dans ~/.nexus-switch, jamais dans l'environnement global.",
    placeholder: '(colle ici)',
    hint: 'Entrée valider · Échap / Entrée vide annuler',
  },
  dialogs: {
    claudeMissingTitle: 'Claude Code CLI absent',
    claudeMissingMessage: 'Nexus lance Claude Code, il doit être installé. Installer maintenant via npm ?',
    modelMissingTitle: 'Modèle non téléchargé',
    modelMissingMessage: (model) => `'${model}' n'est pas sur ta machine. Le télécharger maintenant ? Peut faire plusieurs Go.`,
  },
  setup: {
    claudeMissing: "Claude Code CLI absent. Nexus lance Claude Code, ce n'est pas un agent autonome.",
    claudeInstallHint: `Installation : ${CLAUDE_INSTALL}`,
    claudeInstallAsk: 'Installer maintenant via npm ? [o/N] ',
    claudeInstallAborted: `Abandon. Installation manuelle : ${CLAUDE_INSTALL}`,
    claudeInstallFailed: "Échec de l'installation de Claude Code.",
    ollamaMissing: (model) => `Modèle Ollama '${model}' non installé localement.`,
    ollamaPullHint: (model) => `Télécharge-le : ollama pull ${model}`,
    ollamaPullAsk: (model) => `Télécharger maintenant via 'ollama pull ${model}' ? Peut être volumineux (plusieurs Go). [o/N] `,
    ollamaPullAborted: (model) => `Abandon. Télécharge-le : ollama pull ${model}`,
    ollamaPullFailed: (model) => `Échec du pull de '${model}'.`,
    keyMissing: (provider, varName) => `Clé API absente pour ${provider} (${varName}).`,
    keySetHint: (provider) => `Configure-la : nexus key set ${provider} <clé>`,
    keyAsk: (provider) => `Colle ta clé ${provider} maintenant (Entrée pour annuler) : `,
    keyAborted: (provider) => `Abandon. Configure-la : nexus key set ${provider} <clé>`,
    keySaved: (varName) => `${varName} enregistrée dans ~/.nexus-switch.`,
  },
  cli: {
    keyValid: 'valide',
    keyRejected: 'clé rejetée',
    keyPresent: 'présente',
    keyAbsent: 'absente',
    refreshOpenRouter: (kept, removed, tail) => `OpenRouter: ${kept} modèles conservés, ${removed} retirés${tail}`,
    refreshOllama: (n) => `Ollama    : ${n} modèles (depuis ollama list)`,
    skipped: 'ignoré',
    unsupportedProvider: (provider) => `Provider non supporté : ${provider}`,
    keyDeleted: (varName) => `${varName} supprimée de ~/.nexus-switch.`,
    keyUsage: 'Usage : nexus key set <provider> <clé> | nexus key list | nexus key delete <provider>',
    unknownProvider: (name, available) => `Provider inconnu : ${name}. Disponibles : ${available}`,
    updateAvailable: (version) => `nexus ${version} disponible -> nexus update`,
    creditsKeyPresent: 'clé présente',
    creditsOllama: 'Ollama     : local illimité · cloud quota (https://ollama.com/dashboard)',
    uninstalled: 'Secrets et config supprimés (~/.nexus-switch + env global purgé).',
  },
  credits: {
    keyMissing: 'clé absente',
    providerNotFound: 'provider introuvable',
    noCreditsApi: 'pas de credits_api',
    remaining: (left, used, total) => `${left} restants (utilisé ${used} / ${total})`,
    unreachable: 'injoignable',
  },
  catalog: {
    openRouterEmpty: 'OpenRouter : liste de modèles vide, catalogue inchangé.',
    openRouterNoneLeft: 'OpenRouter : aucun modèle local ne survit, catalogue inchangé.',
    ollamaListFailed: '`ollama list` a échoué (ollama installé ?)',
    ollamaNone: 'aucun modèle Ollama lançable (catalogue inchangé)',
    invalidProvider: (reason) => `Provider ignoré (catalogue invalide) : ${reason}`,
  },
  launch: {
    keyMissing: (provider) => `Clé API absente pour ${provider}. Configure : nexus key set ${provider} <clé>`,
    gatewayFailed: (url, reason) => `Gateway injoignable (${url}) : ${reason}`,
    ollamaSubscription:
      "Modèle réservé aux abonnés Ollama Pro/Max — avec un compte gratuit, Claude Code recevra une erreur 403 'requires a subscription'.\n" +
      'Upgrade : ollama.com/upgrade · gratuits avec quota : minimax-m3:cloud, qwen3-coder:480b-cloud, gpt-oss:120b-cloud',
    ollamaCloud:
      'Modèle Ollama cloud — compte requis (gratuit, sans CB) : ollama.com\n' +
      "Lance `ollama signin` si ce n'est pas encore fait.\n" +
      'Quota gratuit : reset toutes les 5 h + hebdomadaire, 1 modèle concurrent.\n' +
      'Pour lever les limites : Pro 20 $/mois · Max 100 $/mois -> ollama.com/pricing',
    ollamaLocal:
      "Modèle Ollama local : grand contexte = beaucoup de RAM/VRAM. Si 'out of memory' -> bascule sur un modèle :cloud, ou baisse OLLAMA_CONTEXT_LENGTH (ex. 16384) et relance Ollama.",
    ollamaFailed: (reason) => `Échec ollama : ${reason}`,
    ollamaExited: (code, model) => `ollama a quitté (code ${code}). Le modèle '${model}' existe-t-il ? -> ollama list`,
    claudeNotFound: 'Échec claude : introuvable sur le PATH.',
    claudeFailed: (reason) => `Échec claude : ${reason}`,
    bare: (provider) =>
      `${provider} : mode réduit (--bare, sans CLAUDE.md/MCP/hooks), le quota gratuit ne porte pas le prompt complet.\n` +
      'Palier payant ? NEXUS_FULL_PROMPT=1 pour le désactiver.',
  },
  gateway: {
    quotaHint:
      'nexus : requête plus grosse que le quota tokens/minute du provider. ' +
      'Relance avec `-- --bare` (prompt réduit), choisis un autre provider, ou passe au palier payant.',
    providerUnreachable: (url, reason) => `Provider injoignable (${url}) : ${reason}`,
  },
  secrets: {
    refuseWipe: (dir) => `Refus de supprimer ${dir} : répertoire trop large.`,
  },
};
