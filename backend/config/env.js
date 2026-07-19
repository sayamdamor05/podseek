import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function loadBackendEnv() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const backendDir = resolve(currentDir, '..');
  const envPath = resolve(backendDir, '.env');

  return dotenv.config({ path: envPath });
}
