// Bulkimport van VKBO-records (optioneel; de app zoekt ook live).
// Brondata wordt niet gewijzigd: de volledige oorspronkelijke rij gaat mee in `raw`.
//
//   tsx scripts/import-vkbo.ts --nis 11040 --street Paalstraat        (live VKBO-API, open data)
//   tsx scripts/import-vkbo.ts --nis 11040 --geojson KBO/<bestand>     (starterpakket)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { cqlString, fetchVkbo, mapVkbo, saveVkbo, type Municipality } from '../supabase/functions/_shared/vkbo.ts';
import { loadEnv } from './env.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const nis = arg('nis') ?? '11040';
  const street = arg('street');
  const geojson = arg('geojson');
  if (!street && !geojson) throw new Error('Gebruik --street <naam> of --geojson <pad>');

  const env = loadEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: municipalities, error } = await db.from('municipalities').select('id,nis_code,name,bbox');
  if (error) throw error;
  const muni = (municipalities as Municipality[]).find((m) => m.nis_code === nis);
  if (!muni) throw new Error(`Gemeente met NIS ${nis} staat niet in tabel municipalities`);

  let features;
  let retrievedAt: string;
  if (geojson) {
    const j = JSON.parse(readFileSync(geojson, 'utf8'));
    features = j.features;
    retrievedAt = j.timeStamp ?? new Date().toISOString();
  } else {
    features = (await fetchVkbo(`KBO_NISCODE=${cqlString(nis)} AND KBO_Straat=${cqlString(street!)}`, 5000)).features;
    retrievedAt = new Date().toISOString();
  }
  const mapped = mapVkbo(features, municipalities as Municipality[], retrievedAt);
  await saveVkbo(db, mapped);
  console.log(`${muni.name}${street ? ` / ${street}` : ''}: ${mapped.enterprises.length} ondernemingen, ${mapped.establishments.length} vestigingen, ${mapped.stubs.length} moederondernemingen enkel als nummer, ${mapped.evidence.length} registerevidence.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
