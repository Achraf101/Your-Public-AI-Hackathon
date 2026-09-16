// Zoekt zaken op naam, straat, adres of ondernemingsnummer binnen een gekozen gemeente.
// Bron: VKBO (open data, gratis). Nummer niet in VKBO (bv. eenmanszaak)? → KBO API.
// Resultaten zijn "zaken": een onderneming en haar vestiging(en) op hetzelfde adres worden één rij.
// Elke zaak krijgt meteen een score: de volledige score als die al berekend is, anders een snelle score op basis van het register.
// Bij zoeken op naam of straat worden verenigingen van mede-eigenaars en zaken met score < 30 weggelaten.
import { adminClient, handler, json } from '../_shared/http.ts';
import { cqlString, fetchVkbo, mapVkbo, saveVkbo, type Municipality } from '../_shared/vkbo.ts';
import { runKbo } from '../_shared/sources.ts';
import { analyze, type EvidenceRow } from '../_shared/rules.ts';
import { houseNumbers, streetKey } from '../_shared/normalize.ts';

type Mode = 'name' | 'address' | 'street' | 'number';
const STREET_WORDS = /(straat|laan|lei|baan|weg|plein|dreef|dijk|steenweg|hof|pad|markt|kaai|ring|singel|veld|berg)\b/i;
export const MIN_SCORE = 30;

function detect(query: string): Mode {
  const compact = query.replace(/^BE/i, '').replace(/[\s.\-/]/g, '');
  if (/^\d{9,10}$/.test(compact)) return 'number';
  if (/^\D+\s+\d+\s*[a-z]?(\s*(bus|b)\s*\S+)?$/i.test(query.trim())) return 'address';
  if (STREET_WORDS.test(query)) return 'street';
  return 'name';
}

const likeEscape = (s: string) => s.replace(/[%_]/g, ' ').trim();

async function inChunks<T>(values: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 150) out.push(...await fn(values.slice(i, i + 150)));
  return out;
}

Deno.serve(handler(async (req) => {
  const body = await req.json();
  const query = String(body?.query ?? '').trim();
  if (query.length < 2) return json({ error: 'Typ minstens 2 tekens' }, 400);
  const db = adminClient();

  const { data: municipalities, error: mErr } = await db.from('municipalities').select('id,nis_code,name,bbox');
  if (mErr) throw mErr;
  const munis = municipalities as Municipality[];
  const muni = munis.find((m) => m.id === body?.municipality_id);
  if (!muni) return json({ error: 'Kies een gemeente' }, 400);

  const mode = detect(query);
  const nis = cqlString(muni.nis_code);
  let filter: string;
  let number: string | null = null;
  let interpreted: string;
  let maxRecords = 200;

  if (mode === 'number') {
    number = query.replace(/^BE/i, '').replace(/\D/g, '').padStart(10, '0');
    filter = `Ondernemingsnr=${cqlString(number)} OR Ondernemingsnr_maatsch_zetel=${cqlString(number)}`;
    interpreted = `ondernemingsnummer ${number.slice(0, 4)}.${number.slice(4, 7)}.${number.slice(7)}`;
  } else if (mode === 'address') {
    const m = query.match(/^(.+?)[\s,]+(\d+)\s*([a-z]?)(?:\s*(?:bus|b)\s*\S+)?\s*$/i)!;
    const street = likeEscape(m[1]);
    const house = `${m[2]}${m[3] ?? ''}`.toUpperCase();
    filter = `KBO_NISCODE=${nis} AND KBO_Straat ILIKE ${cqlString(`%${street}%`)} AND (KBO_Huisnr=${cqlString(house)} OR KBO_Huisnr=${cqlString(m[2])} OR KBO_Huisnr ILIKE ${cqlString(`${m[2]}-%`)} OR KBO_Huisnr ILIKE ${cqlString(`%-${m[2]}`)})`;
    interpreted = `${street} ${house}, ${muni.name}`;
  } else if (mode === 'street') {
    const street = likeEscape(query);
    filter = `KBO_NISCODE=${nis} AND KBO_Straat ILIKE ${cqlString(`%${street}%`)}`;
    interpreted = `${street}, ${muni.name}`;
    maxRecords = 1500;
  } else {
    const term = cqlString(`%${likeEscape(query)}%`);
    filter = `KBO_NISCODE=${nis} AND (Maatschappelijke_naam ILIKE ${term} OR Commerciele_naam ILIKE ${term} OR Afgekorte_naam ILIKE ${term})`;
    interpreted = `"${query}" in ${muni.name}`;
  }

  const retrievedAt = new Date().toISOString();
  const { features } = await fetchVkbo(filter, maxRecords);
  const mapped = mapVkbo(features, munis, retrievedAt);
  await saveVkbo(db, mapped);

  const estNumbers = mapped.establishments.map((e) => e.establishment_number as string);
  const entNumbers = mapped.enterprises.map((e) => e.enterprise_number as string);
  if (mode === 'number' && number) {
    if (!features.length && /^[01]/.test(number)) await runKbo(db, number, { maxAgeDays: 7 });
    if (!entNumbers.includes(number)) {
      const { data } = await db.from('enterprises').select('enterprise_number').eq('enterprise_number', number).eq('completeness', 'full').maybeSingle();
      if (data) entNumbers.push(number);
    }
  }

  // Alles in één keer laden (geen query per zaak).
  const establishments = await inChunks(estNumbers, async (c) => (await db.from('establishments').select('*').in('establishment_number', c)).data ?? []);
  const parentNumbers = [...new Set([...entNumbers, ...establishments.map((e: any) => e.enterprise_number)])];
  const enterprises = await inChunks(parentNumbers, async (c) => (await db.from('enterprises').select('*').in('enterprise_number', c)).data ?? []);
  const entByNr = new Map(enterprises.map((e: any) => [e.enterprise_number, e]));
  const evidence = [
    ...await inChunks(estNumbers, async (c) => (await db.from('evidence').select('*').in('establishment_number', c)).data ?? []),
    ...await inChunks(parentNumbers, async (c) => (await db.from('evidence').select('*').in('enterprise_number', c).is('establishment_number', null)).data ?? []),
  ] as EvidenceRow[];
  const analyses = [
    ...await inChunks(estNumbers, async (c) => (await db.from('analysis').select('*').eq('is_current', true).eq('subject_type', 'establishment').in('establishment_number', c)).data ?? []),
    ...await inChunks(entNumbers, async (c) => (await db.from('analysis').select('*').eq('is_current', true).eq('subject_type', 'enterprise').in('enterprise_number', c)).data ?? []),
  ] as any[];

  type Row = {
    subject_type: 'establishment' | 'enterprise'; number: string; enterprise_number: string;
    name: string | null; address: string; street: string | null; house_number: string | null; postcode: string | null; municipality: string | null;
    in_municipality: boolean; legal_status_norm: string; enterprise_known: boolean; is_vme: boolean;
    score: number; label: string; confidence: string; score_basis: 'full' | 'register'; registrations: number;
  };

  const score = (subjectType: 'establishment' | 'enterprise', subject: any, ent: any) => {
    const nr = subjectType === 'establishment' ? subject.establishment_number : subject.enterprise_number;
    const existing = analyses.find((a) => a.subject_type === subjectType && (subjectType === 'establishment' ? a.establishment_number === nr : a.enterprise_number === nr));
    if (existing?.activity_score != null) {
      return { score: existing.activity_score, label: existing.activity_label, confidence: existing.confidence, score_basis: 'full' as const };
    }
    const entNr = ent?.enterprise_number ?? subject.enterprise_number;
    const ev = evidence.filter((e) => subjectType === 'establishment'
      ? e.establishment_number === nr || (e.enterprise_number === entNr && !e.establishment_number)
      : e.enterprise_number === nr && !e.establishment_number);
    const r = analyze({
      subject_type: subjectType,
      legal_status_norm: ent?.legal_status_norm ?? 'unknown',
      enterprise_completeness: ent?.completeness ?? 'number_only',
      enterprise_entity_type: ent?.entity_type ?? 'unknown',
      enterprise_legal_form: ent?.legal_form ?? null,
      enterprise_start_date: ent?.start_date ?? null,
      enterprise_ex_officio_strike_off: ent?.ex_officio_strike_off ?? null,
      subject_start_date: subjectType === 'establishment' ? subject.start_date : null,
      subject_address_struck_off: subject.address_struck_off ?? null,
      address_mismatch: subjectType === 'establishment' ? subject.address_mismatch : false,
      geo_quality: subjectType === 'establishment' ? subject.geo_quality : subject.seat_geo_quality,
      evidence: ev,
    });
    return { score: r.activity_score, label: r.activity_label, confidence: r.confidence, score_basis: 'register' as const };
  };

  const rows: Row[] = [
    ...establishments.map((e: any): Row => {
      const ent = entByNr.get(e.enterprise_number);
      return {
        subject_type: 'establishment', number: e.establishment_number, enterprise_number: e.enterprise_number,
        name: e.commercial_name ?? e.name ?? ent?.commercial_name ?? ent?.name ?? null,
        address: [e.kbo_street, e.kbo_house_number, e.kbo_box ? `bus ${e.kbo_box}` : null].filter(Boolean).join(' '),
        street: e.kbo_street, house_number: e.kbo_house_number, postcode: e.kbo_postcode, municipality: e.kbo_municipality,
        in_municipality: e.municipality_id === muni.id, legal_status_norm: ent?.legal_status_norm ?? 'unknown',
        enterprise_known: ent?.completeness === 'full', is_vme: /mede-eigenaars|btw-eenheid/i.test(ent?.legal_form ?? ''),
        registrations: 1, ...score('establishment', e, ent),
      };
    }),
    ...entNumbers.map((n) => entByNr.get(n)).filter(Boolean).map((e: any): Row => ({
      subject_type: 'enterprise', number: e.enterprise_number, enterprise_number: e.enterprise_number,
      name: e.commercial_name ?? e.name,
      address: [e.seat_street, e.seat_house_number, e.seat_box ? `bus ${e.seat_box}` : null].filter(Boolean).join(' '),
      street: e.seat_street, house_number: e.seat_house_number, postcode: e.seat_postcode, municipality: e.seat_municipality,
      in_municipality: e.seat_municipality_id === muni.id, legal_status_norm: e.legal_status_norm,
      enterprise_known: e.completeness === 'full', is_vme: /mede-eigenaars|btw-eenheid/i.test(e.legal_form ?? ''),
      registrations: 1, ...score('enterprise', e, e),
    })),
  ];

  // Samenvoegen: zelfde onderneming op hetzelfde adres = één zaak. Vestiging (fysieke plaats) krijgt voorrang.
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.enterprise_number}|${streetKey(r.street)}|${houseNumbers(r.house_number)[0] ?? r.house_number ?? ''}`;
    const prev = groups.get(key);
    if (!prev) { groups.set(key, r); continue; }
    const better = (a: Row, b: Row) =>
      (a.score_basis === 'full') !== (b.score_basis === 'full') ? (a.score_basis === 'full' ? a : b)
        : a.subject_type !== b.subject_type ? (a.subject_type === 'establishment' ? a : b) : a;
    const keep = better(prev, r);
    groups.set(key, { ...keep, registrations: prev.registrations + 1 });
  }
  let results = [...groups.values()];

  let hiddenNoise = 0;
  let hiddenLow = 0;
  if (mode !== 'number') {
    const before = results.length;
    results = results.filter((r) => r.in_municipality && !r.is_vme);
    hiddenNoise = before - results.length;
    const beforeLow = results.length;
    results = results.filter((r) => r.score >= MIN_SCORE);
    hiddenLow = beforeLow - results.length;
  }

  results.sort((a, b) => Number(b.in_municipality) - Number(a.in_municipality)
    || String(a.street ?? '').localeCompare(String(b.street ?? ''), 'nl')
    || (parseInt(a.house_number ?? '', 10) || 99999) - (parseInt(b.house_number ?? '', 10) || 99999)
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nl'));

  return json({
    mode, interpreted, retrieved_at: retrievedAt, count: results.length, results,
    hidden_low: hiddenLow, hidden_noise: hiddenNoise, min_score: MIN_SCORE,
    truncated: features.length >= maxRecords,
  });
}));
