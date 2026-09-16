// Leest .env in de repo-root (zonder extra dependency). Waarden worden nooit gelogd.
import { readFileSync, existsSync } from 'node:fs';

export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  const merged = { ...env, ...process.env } as Record<string, string>;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!merged[k]) throw new Error(`${k} ontbreekt in .env (zie README: "npx supabase status -o env")`);
  }
  return merged;
}
