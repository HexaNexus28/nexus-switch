import type { Locale } from './i18n.types.js';
import type { SecretStoreInfo } from '../core/secrets.js';

/** What `nexus report` collects. Never holds a secret value — only presence flags. */
export interface Diagnostic {
  nexus: string;
  node: string;
  os: string;
  locale: Locale;
  shell: string;
  terminal: string;
  stdinTty: boolean;
  claude: string;
  ollama: string;
  /** provider id -> key configured */
  keys: Record<string, boolean>;
  store: SecretStoreInfo;
  /** Tail of gateway.log / secrets-errors.log, already redacted. */
  logs: Record<string, string[]>;
}
