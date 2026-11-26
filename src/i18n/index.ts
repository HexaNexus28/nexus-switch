// Locale resolution + the active message set.
//
// Order: NEXUS_LANG (explicit override) > LC_ALL > LC_MESSAGES > LANG (POSIX
// only) > Intl (the system locale). Anything that does not start with "fr"
// falls back to English, the default for a global npm audience.
//
// On Windows the POSIX variables are skipped: they are not a native setting,
// and Git Bash exports LANG=en_US.UTF-8 whatever the system language (seen on a
// fr-FR machine), which would hide the real choice that Intl reports.

import type { Locale } from '../types/i18n.types.js';
import { en, type Messages } from './en.js';
import { fr } from './fr.js';

const MESSAGES: Record<Locale, Messages> = { en, fr };

function intlLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return '';
  }
}

export function detectLocale(
  env: NodeJS.ProcessEnv = process.env,
  systemLocale: string = intlLocale(),
  platform: NodeJS.Platform = process.platform,
): Locale {
  const posix = platform === 'win32' ? [] : [env.LC_ALL, env.LC_MESSAGES, env.LANG];
  // POSIX "C" / "POSIX" locales mean "unset", not English: keep looking.
  const candidates = [env.NEXUS_LANG, ...posix, systemLocale];
  const chosen = candidates.find((value) => value && !/^(C|POSIX)([.@]|$)/i.test(value));
  return chosen?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const locale: Locale = detectLocale();

/** Active messages, resolved once at startup. */
export const t: Messages = MESSAGES[locale];
