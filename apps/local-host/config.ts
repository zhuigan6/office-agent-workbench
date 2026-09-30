import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const local = path.resolve(process.env.WORKBENCH_DATA_DIR || path.join(root, '.local'));
export interface Config {
  port: number; corePort: number; aioncore: string; officecli: string;
  certificateThumbprint: string; pfxPassword: string; uiToken: string; coreSecret: string;
  connectionSource: string; gatewayUrl: string; model: string;
}
export function loadConfig(): Config {
  const result = JSON.parse(fs.readFileSync(path.join(local, 'config.json'), 'utf8'));
  for (const field of ['aioncore','officecli','pfxPassword','uiToken','coreSecret'])
    if (typeof result[field] !== 'string' || !result[field]) throw new Error(`Missing config field: ${field}`);
  return result;
}
