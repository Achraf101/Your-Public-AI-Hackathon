// VKBO (Digitaal Vlaanderen, open data): ophalen en omzetten naar enterprises / establishments / registerevidence.
// Pure TypeScript (fetch is beschikbaar in Node en Deno): gedeeld door importscript en Edge Functions.
import { clean, cleanPhone, geoQuality, kboPublicSearchUrl, LEGAL_STATUS_NL, normalizeLegalStatus, realDate } from './normalize.ts';

export const VKBO_URL = 'https://geo.api.vlaanderen.be/VKBO/ogc/features/v1/collections/Vkbo/items';

export type VkboFeature = { geometry: { coordinates: [number, number] } | null; properties: Record<string, any> };
export type Municipality = { id: string; nis_code: string; name: string; bbox: number[] | null };
type Row = Record<string, unknown>;

export function cqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export async function fetchVkbo(filter: string, maxRecords = 1000): Promise<{ features: VkboFeature[]; url: string }> {
  const pageSize = Math.min(1000, maxRecords);
  const url = `${VKBO_URL}?${new URLSearchParams({ f: 'application/geo+json', limit: String(pageSize), 'filter-lang': 'cql-text', filter })}`;
  const features: VkboFeature[] = [];
  let next: string | null = url;
  while (next && features.length < maxRecords) {
    const r = await fetch(next);
    if (!r.ok) throw new Error(`VKBO HTTP ${r.status}`);
    const j: any = await r.json();
    features.push(...j.features);
    const link = j.links?.find((l: any) => l.rel === 'next');
    next = j.features.length === pageSize && link ? link.href : null;
  }
  return { features: features.slice(0, maxRecords), url };
}

/** Zet VKBO-features om. `municipalities` = alle gekende gemeenten (NIS → id/bbox). */
export function mapVkbo(features: VkboFeature[], municipalities: Municipality[], retrievedAt: string) {
  const byNis = new Map(municipalities.map((m) => [m.nis_code, m]));
  const enterprises: Row[] = [];
  const establishments: Row[] = [];
  const evidence: Row[] = [];

  for (const f of features) {
    const p = f.properties;
    const number = String(p.Ondernemingsnr).trim();
    const parent = clean(p.Ondernemingsnr_maatsch_zetel);
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    const muni = byNis.get(clean(p.KBO_NISCODE) ?? '');
    const bbox = muni?.bbox?.length === 4 ? (muni.bbox as [number, number, number, number]) : undefined;
    const geo = geoQuality(lat, lon, bbox);
    const strikeOff = clean(p.Reden_ambtsh_doorhaling)
      ? { reason: clean(p.Reden_ambtsh_doorhaling), start_date: realDate(p.Begindat_ambtsh_doorhaling), end_date: realDate(p.Einddat_ambtsh_doorhaling) }
      : null;
    const addrStruck = clean(p.Reden_adresdoorhaling)
      ? { reason: clean(p.Reden_adresdoorhaling), date: realDate(p.Datum_adresdoorhaling) }
      : null;
    const base = { source: 'vkbo', source_retrieved_at: retrievedAt, raw: p, updated_at: retrievedAt };

    if (!parent) {
      const status = normalizeLegalStatus(p.Rechtstoestand);
      enterprises.push({
        enterprise_number: number,
        name: clean(p.Maatschappelijke_naam),
        commercial_name: clean(p.Commerciele_naam),
        abbreviation: clean(p.Afgekorte_naam),
        entity_type: clean(p.Type_onderneming) === 'Rechtspersoon' ? 'legal_person' : 'unknown',
        legal_form: clean(p.Rechtsvorm),
        legal_status: clean(p.Rechtstoestand),
        legal_status_norm: status,
        start_date: realDate(p.Startdatum),
        seat_street: clean(p.KBO_Straat), seat_house_number: clean(p.KBO_Huisnr), seat_box: clean(p.KBO_Busnr),
        seat_postcode: clean(p.KBO_Postcode), seat_municipality: clean(p.KBO_Gemeente),
        seat_municipality_id: muni?.id ?? null,
        seat_lat: geo === 'ok' ? lat : null, seat_lon: geo === 'ok' ? lon : null, seat_geo_quality: geo,
        ex_officio_strike_off: strikeOff, address_struck_off: addrStruck,
        phone: cleanPhone(p.Telefoonnummer), email: clean(p.Email),
        nace_main: clean(p.NACE_hoofdact_BTW) ?? clean(p.NACE_hoofdact_RSZ),
        nace_main_description: clean(p.Omschrijving_hoofdact_BTW) ?? clean(p.Omschrijving_hoofdact_RSZ),
        completeness: 'full',
        ...base,
      });
      evidence.push({
        enterprise_number: number, source: 'vkbo', evidence_type: 'legal_status',
        value: { legal_status: clean(p.Rechtstoestand), legal_status_norm: status, legal_form: clean(p.Rechtsvorm) },
        summary_nl: `Register: rechtstoestand ${clean(p.Rechtstoestand) ?? 'onbekend'} (${LEGAL_STATUS_NL[status]})`,
        url: kboPublicSearchUrl(number), retrieved_at: retrievedAt,
      });
      if (strikeOff) evidence.push({
        enterprise_number: number, source: 'vkbo', evidence_type: 'strike_off', value: strikeOff,
        summary_nl: `Register: ambtshalve doorhaling — ${strikeOff.reason}`, observed_at: strikeOff.start_date,
        url: kboPublicSearchUrl(number), retrieved_at: retrievedAt,
      });
      continue;
    }

    const kbo = [clean(p.KBO_Straat), clean(p.KBO_Huisnr), clean(p.KBO_Busnr), clean(p.KBO_Postcode)];
    const ar = [clean(p.AR_straat), clean(p.AR_huisnr), clean(p.AR_busnr), clean(p.AR_postcode)];
    const mismatch = kbo.some((v, i) => (v ?? '') !== (ar[i] ?? ''));
    establishments.push({
      establishment_number: number,
      enterprise_number: parent,
      municipality_id: muni?.id ?? null,
      name: clean(p.Maatschappelijke_naam),
      commercial_name: clean(p.Commerciele_naam),
      start_date: realDate(p.Startdatum),
      kbo_street: kbo[0], kbo_house_number: kbo[1], kbo_box: kbo[2], kbo_postcode: kbo[3], kbo_municipality: clean(p.KBO_Gemeente),
      ar_street: ar[0], ar_house_number: ar[1], ar_box: ar[2], ar_postcode: ar[3],
      address_mismatch: mismatch, address_struck_off: addrStruck,
      lat: geo === 'ok' ? lat : null, lon: geo === 'ok' ? lon : null, geo_quality: geo,
      phone: cleanPhone(p.Telefoonnummer), email: clean(p.Email),
      nace_rsz: clean(p.NACE_hoofdact_RSZ), nace_rsz_description: clean(p.Omschrijving_hoofdact_RSZ),
      ...base,
    });
    if (mismatch) evidence.push({
      establishment_number: number, source: 'vkbo', evidence_type: 'address',
      value: { kbo, address_register: ar },
      summary_nl: `Adres in KBO (${kbo.filter(Boolean).join(' ')}) wijkt af van het adressenregister (${ar.filter(Boolean).join(' ') || 'leeg'})`,
      retrieved_at: retrievedAt,
    });
    if (addrStruck) evidence.push({
      establishment_number: number, source: 'vkbo', evidence_type: 'strike_off', value: addrStruck,
      summary_nl: `Register: adres doorgehaald — ${addrStruck.reason}`, observed_at: addrStruck.date, retrieved_at: retrievedAt,
    });
  }

  const known = new Set(enterprises.map((e) => e.enterprise_number));
  const stubs = [...new Set(establishments.map((e) => e.enterprise_number as string))]
    .filter((n) => !known.has(n))
    .map((n) => ({ enterprise_number: n, completeness: 'number_only', source: 'stub' }));

  return { enterprises, establishments, evidence, stubs };
}

/** Schrijft een mapping weg. `db` = supabase-js client met service role. */
export async function saveVkbo(db: any, mapped: ReturnType<typeof mapVkbo>) {
  const upsert = async (table: string, rows: Row[], opts: Record<string, unknown>) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + 500), opts);
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  };
  await upsert('enterprises', mapped.enterprises, { onConflict: 'enterprise_number' });
  await upsert('enterprises', mapped.stubs, { onConflict: 'enterprise_number', ignoreDuplicates: true });
  await upsert('establishments', mapped.establishments, { onConflict: 'establishment_number' });

  // Registerevidence = momentopname: vervang vorige VKBO-evidence van deze records.
  const entNrs = mapped.enterprises.map((e) => e.enterprise_number as string);
  const estNrs = mapped.establishments.map((e) => e.establishment_number as string);
  for (let i = 0; i < entNrs.length; i += 200) {
    await db.from('evidence').delete().eq('source', 'vkbo').in('enterprise_number', entNrs.slice(i, i + 200)).is('establishment_number', null);
  }
  for (let i = 0; i < estNrs.length; i += 200) {
    await db.from('evidence').delete().eq('source', 'vkbo').in('establishment_number', estNrs.slice(i, i + 200));
  }
  for (let i = 0; i < mapped.evidence.length; i += 500) {
    const { error } = await db.from('evidence').insert(mapped.evidence.slice(i, i + 500));
    if (error) throw new Error(`evidence: ${error.message}`);
  }
}
