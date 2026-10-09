import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Loads the repo-root .env for local development. Real environments inject variables directly. */
export function loadRootEnvFile(): void {
  const path = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
