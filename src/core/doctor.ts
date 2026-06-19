import { claudeExists } from './launch.js';
import { KEY_VARS, readKey } from './keys.js';
import { loadProvider } from './providers.js';

export interface KeyCheck {
  provider: string;
  varName: string;
  present: boolean;
  /** true/false when the provider exposes a credits endpoint and the key was probed; null otherwise. */
  valid: boolean | null;
}

export interface DoctorReport {
  claude: boolean;
  keys: KeyCheck[];
}

async function probeKey(provider: string, key: string): Promise<boolean | null> {
  let creditsApi: string | undefined;
  try {
    creditsApi = loadProvider(provider).credits_api;
  } catch {
    return null;
  }
  if (!creditsApi) return null;
  try {
    const res = await fetch(creditsApi, { headers: { Authorization: `Bearer ${key}` } });
    return res.ok;
  } catch {
    return null;
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const keys: KeyCheck[] = [];
  for (const [provider, varName] of Object.entries(KEY_VARS)) {
    const key = readKey(varName);
    keys.push({
      provider,
      varName,
      present: Boolean(key),
      valid: key ? await probeKey(provider, key) : null,
    });
  }
  return { claude: claudeExists(), keys };
}
