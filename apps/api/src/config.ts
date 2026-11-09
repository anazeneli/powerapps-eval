import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_FILE = process.env.DB_FILE ?? resolve(here, '../data/kyc.sqlite');
export const PORT = Number(process.env.PORT ?? 3001);

export function ensureDataDir(): void {
  mkdirSync(dirname(DB_FILE), { recursive: true });
}
