import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageInfo {
  version: string;
  /** GitHub issues page, from package.json `bugs.url`. */
  bugsUrl: string;
}

/** The package.json shipped next to dist/ — single source for version and repo links. */
export const PACKAGE: PackageInfo = (() => {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string; bugs?: { url?: string } };
    return { version: pkg.version ?? '', bugsUrl: pkg.bugs?.url ?? '' };
  } catch {
    return { version: '', bugsUrl: '' };
  }
})();
