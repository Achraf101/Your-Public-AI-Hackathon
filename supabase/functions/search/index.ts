// Zoekt op naam, adres of ondernemings-/vestigingsnummer binnen een gekozen gemeente.
// Bron: VKBO (open data, gratis, geen limiet). Nummer niet in VKBO (bv. eenmanszaak)? → KBO API (telt tegen limiet).
// Gevonden records worden in de database bewaard zodat ze meteen gecontroleerd kunnen worden.
import { adminClient, handler, json } from '../_shared/http.ts';
import { cqlString, fetchVkbo, mapVkbo, saveVkbo, type Municipality } from '../_shared/vkbo.ts';
import { runKbo } from '../_shared/sources.ts';

type Mode = 'name' | 'address' | 'number';
const STREET_WORDS = /(straat|laan|lei|baan|weg|plein|dreef|dijk|steenweg|hof|pad|markt|kaai|ring|singel)\b/i;
const MAX_RECORDS = 150;

function detect(query: string): Mode {
  const compact = query.replace(/^BE/i, '').replace(/[\s.\-/]/g, '');
  if (/^\d{9,10}$/.test(compact)) return 'number';
  if (/^\D+\s+\d+\s*[a-z]?(\s*(bus|b)\s*\S+)?$/i.test(query.trim()) || STREET_WORDS.test(query)) return 'address';
  return 'name';
}

const likeEscape = (s: string) => s.replace(/[%_]/g, ' ').trim();

Deno.serve(handler(async (req) => {
  const body = await req.json();
  const query = String(body?.query ?? '').trim();
  if (query.length < 2) return json({ error: 'Geef minstens 2 tekens in' }, 400);
  const db = adminClient();

  const { data: municipalities, error: mErr } = await db.from('municipalities').select('id,nis_code,name,bbox');
  if (mErr) throw mErr;
  const munis = municipalities as Municipality[];
  const muni = munis.find((m) => m.id === body?.municipality_id);
  if (!muni) return json({ error: 'Kies een gemeente' }, 400);

  const mode: Mode = ['name', 'address', 'number'].includes(body?.mode) ? body.mode : detect(query);
  const nis = cqlString(muni.nis_code);
  let filter: string;
  let number: string | null = null;
  let interpreted: string;

  if (mode === 'number') {
    number = query.replace(/^BE/i, '').replace(/\D/g, '').padStart(10, '0');
    if (!/^\d{10}$/.test(number)) return json({ error: 'Een ondernemings- of vestigingsnummer heeft 10 cijfers' }, 400);
    filter = `Ondernemingsnr=${cqlString(number)} OR Ondernemingsnr_maatsch_zetel=${cqlString(number)}`;
    interpreted = `nummer ${number} (onderneming of vestiging, alle Vlaamse gemeenten)`;
  } else if (mode === 'address') {
    const m = query.match(/^(.+?)[\s,]+(\d+)\s*([a-z]?)(?:\s*(?:bus|b)\s*\S+)?\s*$/i);
    const street = likeEscape(m ? m[1] : query);
    const house = m ? `${m[2]}${m[3] ?? ''}`.toUpperCase() : null;
    filter = `KBO_NISCODE=${nis} AND KBO_Straat ILIKE ${cqlString(`%${street}%`)}`;
    if (house && m) {
      filter += ` AND (KBO_Huisnr=${cqlString(house)} OR KBO_Huisnr=${cqlString(m[2])} OR KBO_Huisnr ILIKE ${cqlString(`${m[2]}-%`)} OR KBO_Huisnr ILIKE ${cqlString(`%-${m[2]}`)})`;
    }
    interpreted = `adres "${street}${house ? ` ${house}` : ''}" in ${muni.name}`;
  } else {
    const term = cqlString(`%${likeEscape(query)}%`);
    filter = `KBO_NISCODE=${nis} AND (Maatschappelijke_naam ILIKE ${term} OR Commerciele_naam ILIKE ${term} OR Afgekorte_naam ILIKE ${term})`;
    interpreted = `naam "${query}" in ${muni.name}`;
  }

  const retrievedAt = new Date().toISOString();
  const { features } = await fetchVkbo(filter, MAX_RECORDS);
  const mapped = mapVkbo(features, munis, retrievedAt);
  await saveVkbo(db, mapped);

  const notes: string[] = [];
  const estNumbers = mapped.establishments.map((e) => e.establishment_number as string);
  const entNumbers = mapped.enterprises.map((e) => e.enterprise_number as string);

  if (mode === 'number' && number) {
    // Nummer niet in VKBO → KBO API (bv. onderneming van een natuurlijk persoon).
    if (!features.length && /^[01]/.test(number)) {
      const step = await runKbo(db, number, { maxAgeDays: 7 });
      notes.push(step.message);
    }
    // Gezochte onderneming mee tonen (ook als enkel haar vestigingen in de VKBO staan).
    if (!entNumbers.includes(number)) {
      const { data } = await db.from('enterprises').select('enterprise_number').eq('enterprise_number', number).maybeSingle();
      if (data) entNumbers.push(number);
    }
  }

  const [est, ent] = await Promise.all([
    estNumbers.length
      ? db.from('establishments')
        .select('establishment_number,enterprise_number,name,commercial_name,kbo_street,kbo_house_number,kbo_box,kbo_postcode,kbo_municipality,municipality_id,start_date,enterprises(name,legal_status_norm,completeness,seat_municipality)')
        .in('establishment_number', estNumbers)
      : Promise.resolve({ data: [] as any[] }),
    entNumbers.length
      ? db.from('enterprises')
        .select('enterprise_number,name,commercial_name,legal_status_norm,completeness,seat_street,seat_house_number,seat_box,seat_postcode,seat_municipality,seat_municipality_id,start_date')
        .in('enterprise_number', entNumbers)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const analyses: any[] = [];
  if (estNumbers.length) {
    const { data } = await db.from('analysis').select('*').eq('is_current', true).eq('subject_type', 'establishment').in('establishment_number', estNumbers);
    analyses.push(...(data ?? []));
  }
  if (entNumbers.length) {
    const { data } = await db.from('analysis').select('*').eq('is_current', true).eq('subject_type', 'enterprise').in('enterprise_number', entNumbers);
    analyses.push(...(data ?? []));
  }
  const pick = (a: any) => a ? { activity_score: a.activity_score, activity_label: a.activity_label, confidence: a.confidence, proposed_status: a.proposed_status, created_at: a.created_at } : null;

  const results = [
    ...(est.data ?? []).map((e: any) => ({
      subject_type: 'establishment', number: e.establishment_number, enterprise_number: e.enterprise_number,
      name: e.commercial_name ?? e.name, official_name: e.name,
      address: [e.kbo_street, e.kbo_house_number, e.kbo_box ? `bus ${e.kbo_box}` : null].filter(Boolean).join(' '),
      postcode: e.kbo_postcode, municipality: e.kbo_municipality, in_municipality: e.municipality_id === muni.id,
      enterprise_name: e.enterprises?.name ?? null, enterprise_completeness: e.enterprises?.completeness ?? 'number_only',
      legal_status_norm: e.enterprises?.legal_status_norm ?? 'unknown', seat_municipality: e.enterprises?.seat_municipality ?? null,
      start_date: e.start_date,
      analysis: pick(analyses.find((a) => a.subject_type === 'establishment' && a.establishment_number === e.establishment_number)),
    })),
    ...(ent.data ?? []).map((e: any) => ({
      subject_type: 'enterprise', number: e.enterprise_number, enterprise_number: e.enterprise_number,
      name: e.commercial_name ?? e.name, official_name: e.name,
      address: [e.seat_street, e.seat_house_number, e.seat_box ? `bus ${e.seat_box}` : null].filter(Boolean).join(' '),
      postcode: e.seat_postcode, municipality: e.seat_municipality, in_municipality: e.seat_municipality_id === muni.id,
      enterprise_name: e.name, enterprise_completeness: e.completeness, legal_status_norm: e.legal_status_norm, seat_municipality: e.seat_municipality,
      start_date: e.start_date,
      analysis: pick(analyses.find((a) => a.subject_type === 'enterprise' && a.enterprise_number === e.enterprise_number)),
    })),
  ].sort((a, b) => Number(b.in_municipality) - Number(a.in_municipality) || String(a.address).localeCompare(String(b.address), 'nl', { numeric: true }));

  if (features.length >= MAX_RECORDS) notes.push(`Meer dan ${MAX_RECORDS} registerrecords: verfijn de zoekopdracht.`);
  return json({ mode, interpreted, source: 'VKBO (Digitaal Vlaanderen)', retrieved_at: retrievedAt, count: results.length, results, notes });
}));
