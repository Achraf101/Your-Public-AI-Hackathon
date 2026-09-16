// Vult de tabel municipalities uit de officiële gemeentegrenzen (VRBG 2025, Digitaal Vlaanderen, open data).
// Per gemeente: NIS-code, naam en bounding box (gebruikt om onbetrouwbare coördinaten te herkennen).
//
//   tsx scripts/sync-municipalities.ts                      provincie Antwerpen (NIS begint met 1)
//   tsx scripts/sync-municipalities.ts --prefix 4 --province Oost-Vlaanderen
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.ts';

const SOURCE = 'https://geo.api.vlaanderen.be/VRBG2025/ogc/features/v1/collections/RefgemG100/items';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const prefix = arg('prefix', '1');
  const province = arg('province', 'Antwerpen');
  if (!/^\d$/.test(prefix)) throw new Error('--prefix moet één cijfer zijn (eerste cijfer van de NIS-code)');

  const url = `${SOURCE}?${new URLSearchParams({ f: 'application/geo+json', limit: '1000', 'filter-lang': 'cql-text', filter: `NISCODE LIKE '${prefix}%'` })}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`VRBG HTTP ${r.status}`);
  const { features } = await r.json() as { features: { properties: { NISCODE: string; NAAM: string }; bbox?: number[] }[] };
  if (!features.length) throw new Error('Geen gemeenten gevonden');

  const rows = features.map((f) => ({
    nis_code: f.properties.NISCODE,
    name: f.properties.NAAM,
    province,
    bbox: f.bbox?.length === 4 ? f.bbox : null,
  }));

  const env = loadEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error } = await db.from('municipalities').upsert(rows, { onConflict: 'nis_code' });
  if (error) throw error;
  console.log(`${rows.length} gemeenten (provincie ${province}) gesynchroniseerd uit VRBG 2025.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
