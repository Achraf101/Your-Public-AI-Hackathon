// Bronmodules: elke functie haalt één externe bron op en bewaart het resultaat als evidence.
// Alle functies geven een StepResult terug en gooien geen fouten naar de orchestrator (check-activity),
// zodat één falende bron de rest niet blokkeert.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { consumeQuota, hasRecentEvidence } from './http.ts';
import {
  cleanPhone, distanceMeters, houseNumbers, kboPublicSearchUrl, LEGAL_STATUS_NL, nameSimilarity, normalizeLegalStatus, stripAccents, streetKey,
} from './normalize.ts';

export type StepResult = { source: string; status: 'ok' | 'cached' | 'skipped' | 'limit' | 'error'; message: string };
type Subject = { subject_type: 'enterprise' | 'establishment'; number: string };

const day = 86400000;

// ============================================================================
// KBO API (CBEAPI) — officiële ondernemingsgegevens
// ============================================================================
export async function runKbo(db: SupabaseClient, number: string, opts: { maxAgeDays?: number } = {}): Promise<StepResult> {
  const source = 'kbo_api';
  try {
    const token = Deno.env.get('KBO_API_TOKEN');
    if (!token) return { source, status: 'skipped', message: 'KBO_API_TOKEN ontbreekt' };
    if (opts.maxAgeDays && await hasRecentEvidence(db, source, 'enterprise_number', number, opts.maxAgeDays, (q) => q.is('establishment_number', null))) {
      return { source, status: 'cached', message: `KBO-gegevens van de laatste ${opts.maxAgeDays} dagen hergebruikt` };
    }
    if (!(await consumeQuota(db, source, { dailyEnv: 'KBO_API_DAILY_LIMIT', dailyDefault: 200, monthlyEnv: 'KBO_API_MONTHLY_LIMIT', monthlyDefault: 5000 }))) {
      return { source, status: 'limit', message: 'Limiet KBO API bereikt; geen request verstuurd' };
    }
    const base = Deno.env.get('KBO_API_BASE_URL') ?? 'https://cbeapi.be/api';
    const r = await fetch(`${base}/v1/company/${number}?lang=nl`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'nl' },
    });
    const retrieved_at = new Date().toISOString();
    const url = kboPublicSearchUrl(number);
    if (r.status === 404) {
      await db.from('evidence').insert({ enterprise_number: number, source, evidence_type: 'no_result', value: {}, url, retrieved_at, summary_nl: 'KBO API: ondernemingsnummer niet gevonden' });
      return { source, status: 'ok', message: 'Niet gevonden in de KBO API' };
    }
    const payload = await r.json();
    if (!r.ok) return { source, status: 'error', message: `KBO API fout ${r.status}: ${payload?.message ?? 'onbekend'}` };
    const c = payload.data ?? payload;

    const { data: existing } = await db.from('enterprises').select('*').eq('enterprise_number', number).maybeSingle();
    const statusNorm = normalizeLegalStatus(c.juridical_situation);
    const mainNace = (c.nace_activities ?? []).find((a: any) => a.classification === 'main') ?? c.nace_activities?.[0];
    const phone = cleanPhone(c.contact_infos?.phone);
    const email = c.contact_infos?.email || null;
    const web = c.contact_infos?.web || null;

    if (!existing || existing.completeness === 'number_only') {
      const { error } = await db.from('enterprises').upsert({
        enterprise_number: number, name: c.denomination ?? null, commercial_name: c.commercial_name ?? null, abbreviation: c.abbreviation ?? null,
        entity_type: c.type === 'natural_person' ? 'natural_person' : c.type ? 'legal_person' : 'unknown',
        legal_form: c.juridical_form ?? null, legal_status: c.juridical_situation ?? null, legal_status_norm: statusNorm,
        start_date: c.start_date ?? null,
        seat_street: c.address?.street ?? null, seat_house_number: c.address?.street_number ?? null, seat_box: c.address?.box || null,
        seat_postcode: c.address?.post_code ?? null, seat_municipality: c.address?.city ?? null,
        phone, email, nace_main: mainNace?.code ?? null, nace_main_description: mainNace?.description ?? null,
        completeness: 'full', source, source_retrieved_at: retrieved_at, raw: c, updated_at: retrieved_at,
      }, { onConflict: 'enterprise_number' });
      if (error) throw error;
    } else if (existing.entity_type === 'unknown' && c.type) {
      await db.from('enterprises').update({ entity_type: c.type === 'natural_person' ? 'natural_person' : 'legal_person' }).eq('enterprise_number', number);
    }

    const rows: Record<string, unknown>[] = [{
      enterprise_number: number, source, evidence_type: 'legal_status', url, retrieved_at, raw: c, observed_at: c.start_date ?? null,
      value: { status: c.status, juridical_situation: c.juridical_situation, legal_status_norm: statusNorm, type: c.type, juridical_form: c.juridical_form, start_date: c.start_date },
      summary_nl: `KBO: ${c.pretty_type ?? 'onderneming'}, status ${c.status ?? 'onbekend'}, rechtstoestand ${c.juridical_situation ?? 'onbekend'} (${LEGAL_STATUS_NL[statusNorm]}), gestart ${c.start_date ?? 'onbekend'}`,
    }];
    if (existing?.completeness === 'full' && existing.legal_status_norm !== statusNorm && statusNorm !== 'unknown') {
      rows.push({
        enterprise_number: number, source, evidence_type: 'legal_status', url, retrieved_at,
        value: { vkbo: existing.legal_status, kbo_api: c.juridical_situation, conflict: true },
        summary_nl: `Verschil: VKBO meldt "${existing.legal_status}", KBO API meldt "${c.juridical_situation}"`,
      });
    }
    if (mainNace) rows.push({
      enterprise_number: number, source, evidence_type: 'activity', url, retrieved_at, value: { nace: c.nace_activities },
      summary_nl: `KBO: hoofdactiviteit ${mainNace.code} — ${mainNace.description}`,
    });
    if (phone || email || web) rows.push({
      enterprise_number: number, source, evidence_type: 'phone', url, retrieved_at, value: { phone, email, web, scope: 'onderneming (zetel)' },
      summary_nl: `KBO: contact op niveau onderneming — ${[phone, email, web].filter(Boolean).join(' · ')}`,
    });
    const { data: knownEst } = await db.from('establishments').select('establishment_number').eq('enterprise_number', number);
    const knownSet = new Set((knownEst ?? []).map((e: any) => e.establishment_number));
    const allEst = c.establishments ?? [];
    for (const est of allEst) {
      if (!knownSet.has(est.establishment_number)) continue;
      rows.push({
        establishment_number: est.establishment_number, enterprise_number: number, source,
        evidence_type: est.date_striking_off ? 'strike_off' : 'address', url, retrieved_at, value: est,
        observed_at: est.date_striking_off ?? est.start_date ?? null,
        summary_nl: est.date_striking_off
          ? `KBO: vestiging doorgehaald op ${est.date_striking_off}`
          : `KBO: vestiging actief geregistreerd op ${est.full_address} (sinds ${est.start_date ?? 'onbekend'})`,
      });
    }
    const { error } = await db.from('evidence').insert(rows);
    if (error) throw error;
    return { source, status: 'ok', message: `KBO: ${c.juridical_situation ?? 'status onbekend'}, ${allEst.length} vestiging(en) in totaal` };
  } catch (e) {
    return { source, status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Google Places API (New) — publieke vermelding, nooit automatisch gekoppeld
// ============================================================================
const GOOGLE_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.location',
  'places.businessStatus', 'places.googleMapsUri', 'places.websiteUri', 'places.nationalPhoneNumber',
  'places.regularOpeningHours', 'places.rating', 'places.userRatingCount', 'places.types',
].join(',');
const GOOGLE_STATUS_NL: Record<string, string> = {
  OPERATIONAL: 'open (OPERATIONAL)',
  CLOSED_TEMPORARILY: 'tijdelijk gesloten (CLOSED_TEMPORARILY)',
  CLOSED_PERMANENTLY: 'definitief gesloten (CLOSED_PERMANENTLY)',
};

type Target = {
  names: string[]; street: string | null; houseNumber: string | null; postcode: string | null; municipality: string | null;
  lat: number | null; lon: number | null; enterprise_number: string | null; establishment_number: string | null;
  phones: string[]; domains: string[];
};

/** Laatste 9 cijfers: 03 828 83 16, +32 3 828 83 16 en 038288316 worden gelijk. */
const phoneKey = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : null; };
const hostKey = (u: string | null | undefined) => {
  if (!u) return null;
  const s = u.includes('@') ? u.split('@')[1] : u;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s.trim()}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

async function loadTarget(db: SupabaseClient, s: Subject): Promise<Target> {
  let base: Omit<Target, 'phones' | 'domains'>;
  let entNr: string;
  const phones: (string | null)[] = [];
  const mails: (string | null)[] = [];
  if (s.subject_type === 'establishment') {
    const { data: e, error } = await db.from('establishments').select('*').eq('establishment_number', s.number).single();
    if (error) throw new Error(`Vestiging ${s.number} niet gevonden`);
    base = {
      names: [e.commercial_name, e.name].filter(Boolean), street: e.kbo_street, houseNumber: e.kbo_house_number, postcode: e.kbo_postcode,
      municipality: e.kbo_municipality, lat: e.lat, lon: e.lon, enterprise_number: null, establishment_number: s.number,
    };
    entNr = e.enterprise_number;
    phones.push(e.phone); mails.push(e.email);
  } else {
    const { data: e, error } = await db.from('enterprises').select('*').eq('enterprise_number', s.number).single();
    if (error) throw new Error(`Onderneming ${s.number} niet gevonden`);
    base = {
      names: [e.commercial_name, e.name, e.abbreviation].filter(Boolean), street: e.seat_street, houseNumber: e.seat_house_number,
      postcode: e.seat_postcode, municipality: e.seat_municipality, lat: e.seat_lat, lon: e.seat_lon, enterprise_number: s.number, establishment_number: null,
    };
    entNr = s.number;
  }
  // Contactgegevens uit het register (VKBO + KBO API) voor de identiteitscheck.
  const { data: ent } = await db.from('enterprises').select('phone,email').eq('enterprise_number', entNr).maybeSingle();
  phones.push(ent?.phone ?? null); mails.push(ent?.email ?? null);
  const { data: kbo } = await db.from('evidence').select('value').eq('source', 'kbo_api').eq('enterprise_number', entNr).eq('evidence_type', 'phone');
  for (const k of kbo ?? []) { phones.push(k.value?.phone); mails.push(k.value?.email); mails.push(k.value?.web); }
  const domains = mails.map(hostKey).filter((d): d is string => !!d && !GENERIC_MAIL.test(d + '.') && !GENERIC_MAIL.test(d));
  return { ...base, phones: [...new Set(phones.map(phoneKey).filter((p): p is string => !!p))], domains: [...new Set(domains)] };
}

function component(place: any, type: string): string | null {
  return place.addressComponents?.find((c: any) => c.types?.includes(type))?.longText ?? null;
}

export function assessGoogleMatch(t: Target, place: any) {
  const name = place.displayName?.text ?? '';
  const nameScore = Math.max(0, ...t.names.map((n) => nameSimilarity(n, name)));
  const gStreet = component(place, 'route');
  const gNumber = component(place, 'street_number');
  const gPostcode = component(place, 'postal_code');
  const streetMatch = !!gStreet && !!t.street && streetKey(gStreet) === streetKey(t.street);
  const kboNumbers = houseNumbers(t.houseNumber);
  const numberMatch = !!gNumber && houseNumbers(gNumber).some((n) => kboNumbers.includes(n));
  const postcodeMatch = !!gPostcode && gPostcode === t.postcode;
  const distance = t.lat != null && t.lon != null && place.location
    ? Math.round(distanceMeters(t.lat, t.lon, place.location.latitude, place.location.longitude)) : null;
  const addressMatch = streetMatch && numberMatch;
  // Identiteitscheck: zelfde telefoonnummer of zelfde website/e-maildomein als in het register.
  const gPhone = phoneKey(place.nationalPhoneNumber);
  const gHost = hostKey(place.websiteUri);
  const phoneMatch = !!gPhone && t.phones.includes(gPhone);
  const domainMatch = !!gHost && t.domains.some((d) => d === gHost || gHost.endsWith('.' + d) || d.endsWith('.' + gHost));
  const identityMatch = phoneMatch || domainMatch;

  let quality: 'exact' | 'probable' | 'uncertain' = 'uncertain';
  if ((addressMatch && nameScore >= 0.8) || (identityMatch && addressMatch)) quality = 'exact';
  else if (identityMatch || (addressMatch && nameScore >= 0.5) || (nameScore >= 0.8 && streetMatch) || (nameScore >= 0.8 && distance != null && distance <= 75)) quality = 'probable';
  const explanation = [
    `naam ${Math.round(nameScore * 100)}% gelijk ("${name}")`,
    streetMatch ? 'straat gelijk' : `straat verschilt (${gStreet ?? 'onbekend'})`,
    numberMatch ? 'huisnummer gelijk' : `huisnummer verschilt (${gNumber ?? 'onbekend'})`,
    postcodeMatch ? 'postcode gelijk' : `postcode ${gPostcode ?? 'onbekend'}`,
    distance != null ? `${distance} m van registercoördinaat` : 'geen betrouwbare registercoördinaat',
    phoneMatch ? 'telefoon gelijk aan register' : null,
    domainMatch ? 'website/e-maildomein gelijk aan register' : null,
  ].filter(Boolean).join(' · ');
  return {
    quality,
    score: nameScore + (addressMatch ? 1 : streetMatch ? 0.3 : 0) + (identityMatch ? 1.5 : 0),
    details: { nameScore, streetMatch, numberMatch, postcodeMatch, distance, phoneMatch, domainMatch, explanation },
  };
}

export async function runGoogle(db: SupabaseClient, s: Subject, opts: { force?: boolean } = {}): Promise<StepResult> {
  const source = 'google_places';
  try {
    const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!key) return { source, status: 'skipped', message: 'GOOGLE_PLACES_API_KEY ontbreekt' };
    const col = s.subject_type === 'establishment' ? 'establishment_number' : 'enterprise_number';
    const cacheDays = Number(Deno.env.get('GOOGLE_PLACES_CACHE_DAYS') ?? 7);
    if (!opts.force && await hasRecentEvidence(db, source, col, s.number, cacheDays)) {
      return { source, status: 'cached', message: `Google-resultaten van de laatste ${cacheDays} dagen hergebruikt (geen kosten)` };
    }
    const t = await loadTarget(db, s);
    if (!t.names.length) return { source, status: 'skipped', message: 'Geen naam om op te zoeken' };
    if (!(await consumeQuota(db, source, { dailyEnv: 'GOOGLE_PLACES_DAILY_LIMIT', dailyDefault: 10, monthlyEnv: 'GOOGLE_PLACES_MONTHLY_LIMIT', monthlyDefault: 900 }))) {
      return { source, status: 'limit', message: 'Gratis limiet Google Places bereikt (dag of maand); geen request verstuurd' };
    }
    const search = async (textQuery: string, withBias: boolean) => {
      const body: Record<string, unknown> = { textQuery, languageCode: 'nl', regionCode: 'BE', pageSize: 3 };
      if (withBias && t.lat != null && t.lon != null) body.locationBias = { circle: { center: { latitude: t.lat, longitude: t.lon }, radius: 500 } };
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK }, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`Google Places fout ${r.status}: ${data?.error?.message ?? 'onbekend'}`);
      return (data.places ?? []) as any[];
    };
    // Een zaak heeft altijd een businessStatus; resultaten zonder zijn enkel een adres/gebouw (bv. een woning).
    const isBusiness = (p: any) => !!p.businessStatus;

    const textQuery = [t.names[0], t.street, t.houseNumber, t.postcode, t.municipality].filter(Boolean).join(' ');
    let raw = await search(textQuery, true);
    const queries = [textQuery];
    let addressOnly = raw.length > 0 && !raw.some(isBusiness);
    // Tweede poging op naam + gemeente (bv. zaak staat op Google onder een ander adres). Telt mee in de limiet.
    if (!raw.some(isBusiness) && t.municipality) {
      const fallbackQuery = `${t.names[0]} ${t.municipality}`;
      if (await consumeQuota(db, source, { dailyEnv: 'GOOGLE_PLACES_DAILY_LIMIT', dailyDefault: 10, monthlyEnv: 'GOOGLE_PLACES_MONTHLY_LIMIT', monthlyDefault: 900 })) {
        const extra = await search(fallbackQuery, false);
        queries.push(fallbackQuery);
        raw = [...raw, ...extra.filter((p) => !raw.some((q) => q.id === p.id))];
      }
    }
    const places = raw.filter(isBusiness);
    addressOnly = addressOnly && !places.length;

    const retrieved_at = new Date().toISOString();
    const subjectRef = { enterprise_number: t.enterprise_number, establishment_number: t.establishment_number };
    const rows: Record<string, unknown>[] = [];
    if (!places.length) {
      const addr = raw.find((p) => !isBusiness(p));
      rows.push({
        ...subjectRef, source, evidence_type: 'no_result', retrieved_at, url: addr?.googleMapsUri ?? null,
        value: { queries, address_only: addressOnly, non_business_results: raw.map((p) => ({ name: p.displayName?.text, address: p.formattedAddress, types: p.types ?? [] })) },
        summary_nl: addressOnly
          ? `Google Places: geen zaak gevonden voor "${t.names[0]}" — enkel het adres zelf (${addr?.formattedAddress ?? 'gebouw/woning'}), zonder bedrijfsvermelding`
          : `Google Places: geen zaak gevonden (${queries.map((q) => `"${q}"`).join(' en ')})`,
      });
    }
    const assessed = places.map((p) => ({ p, m: assessGoogleMatch(t, p) })).sort((a, b) => b.m.score - a.m.score);
    assessed.forEach(({ p, m }, i) => {
      const common = { ...subjectRef, source, source_record_id: p.id, url: p.googleMapsUri ?? null, retrieved_at, match_quality: m.quality, match_details: m.details };
      rows.push({
        ...common, evidence_type: 'place_match', raw: p,
        value: { rank: i + 1, textQuery: queries.join(' | '), name: p.displayName?.text, address: p.formattedAddress, business_status: p.businessStatus ?? null, rating: p.rating ?? null, user_rating_count: p.userRatingCount ?? null, types: p.types ?? [] },
        summary_nl: `Google-kandidaat ${i + 1}: ${p.displayName?.text ?? '?'} — ${p.formattedAddress ?? 'adres onbekend'} (match: ${m.quality}; ${m.details.explanation})`,
      });
      if (i !== 0 || m.quality === 'uncertain') return;
      if (p.businessStatus) rows.push({ ...common, evidence_type: 'business_status', value: { business_status: p.businessStatus, user_rating_count: p.userRatingCount ?? null }, summary_nl: `Google Places: ${GOOGLE_STATUS_NL[p.businessStatus] ?? p.businessStatus}${p.userRatingCount ? ` · ${p.userRatingCount} beoordelingen (${p.rating}★)` : ''}` });
      if (p.regularOpeningHours?.weekdayDescriptions?.length) rows.push({ ...common, evidence_type: 'opening_hours', value: { weekday_descriptions: p.regularOpeningHours.weekdayDescriptions }, summary_nl: `Google Places: openingsuren vermeld (${p.regularOpeningHours.weekdayDescriptions.length} dagen)` });
      if (p.websiteUri) rows.push({ ...common, evidence_type: 'website', value: { website: p.websiteUri }, url: p.websiteUri, summary_nl: `Google Places: website ${p.websiteUri}` });
      if (p.nationalPhoneNumber) rows.push({ ...common, evidence_type: 'phone', value: { phone: p.nationalPhoneNumber, scope: 'lokale vermelding' }, summary_nl: `Google Places: telefoon ${p.nationalPhoneNumber}` });
      if (p.formattedAddress) rows.push({ ...common, evidence_type: 'address', value: { address: p.formattedAddress }, summary_nl: `Google Places: adres ${p.formattedAddress}` });
    });
    const { error } = await db.from('evidence').insert(rows);
    if (error) throw error;
    return { source, status: 'ok', message: places.length ? `Google: ${places.length} zaak/zaken gevonden, beste match ${assessed[0].m.quality}` : addressOnly ? 'Google: geen zaak op dit adres (enkel het gebouw/woning)' : `Google: geen zaak gevonden (${queries.length} zoekpoging${queries.length > 1 ? 'en' : ''})` };
  } catch (e) {
    return { source, status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Jaarrekening.be API — laatste jaarrekening, kerncijfers en Staatsblad-publicaties (enkel ondernemingsniveau)
// ============================================================================
export async function runAccounts(db: SupabaseClient, number: string, entityType: string | null): Promise<StepResult> {
  const source = 'jaarrekening';
  try {
    if (Deno.env.get('JAARREKENING_ENABLED') !== 'true') return { source, status: 'skipped', message: 'Jaarrekening-koppeling nog niet geactiveerd' };
    if (entityType === 'natural_person') return { source, status: 'skipped', message: 'Natuurlijke persoon: geen neerleggingsplicht jaarrekening' };
    const token = Deno.env.get('JAARREKENING_API_TOKEN');
    if (!token) return { source, status: 'skipped', message: 'JAARREKENING_API_TOKEN ontbreekt' };
    const cacheDays = Number(Deno.env.get('JAARREKENING_CACHE_DAYS') ?? 30);
    if (await hasRecentEvidence(db, source, 'enterprise_number', number, cacheDays, (q) => q.is('establishment_number', null))) {
      return { source, status: 'cached', message: `Jaarrekeninggegevens van de laatste ${cacheDays} dagen hergebruikt` };
    }
    // Afkoelperiode: na een fout (bv. accountlimiet) niet elke controle opnieuw proberen.
    const { data: recentError } = await db.from('evidence').select('id').eq('source', source).eq('evidence_type', 'error')
      .gte('retrieved_at', new Date(Date.now() - 6 * 3600000).toISOString()).limit(1);
    if (recentError?.length) return { source, status: 'limit', message: 'Jaarrekening.be gaf recent een fout (bv. accountlimiet); volgende poging binnen 6 uur' };
    if (!(await consumeQuota(db, source, { amount: 3, dailyEnv: 'JAARREKENING_DAILY_LIMIT', dailyDefault: 60, monthlyEnv: 'JAARREKENING_MONTHLY_LIMIT', monthlyDefault: 190 }))) {
      return { source, status: 'limit', message: 'Limiet Jaarrekening API bereikt; geen request verstuurd' };
    }
    const base = Deno.env.get('JAARREKENING_API_BASE_URL') ?? 'https://jaarrekening.be/api/v1';
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (r.status === 404) return null;
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) throw new Error('Jaarrekening.be: API-limiet van het account bereikt');
      if (!r.ok) throw new Error(`Jaarrekening.be fout ${r.status}: ${j?.message ?? 'onbekend'}`);
      return j?.data ?? j;
    };
    const retrieved_at = new Date().toISOString();
    const details = await get(`/enterprises/${number}`);
    if (!details) {
      await db.from('evidence').insert({ enterprise_number: number, source, evidence_type: 'no_result', value: {}, retrieved_at, summary_nl: 'Jaarrekening.be: onderneming niet gevonden' });
      return { source, status: 'ok', message: 'Niet gevonden bij jaarrekening.be' };
    }
    const [financials, publications] = await Promise.all([get(`/enterprises/${number}/financials`), get(`/enterprises/${number}/publications`)]);
    const years: number[] = (Array.isArray(financials) ? financials : []).map((f: any) => Number(f.year)).filter(Boolean).sort((a, b) => b - a);
    const pubs: any[] = Array.isArray(publications) ? publications : [];
    const latestPub = pubs.map((p) => p).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const url = details.url ?? null;
    const rows: Record<string, unknown>[] = [{
      enterprise_number: number, source, evidence_type: 'annual_account', url, retrieved_at, raw: { details, years },
      observed_at: years[0] ? `${years[0]}-12-31` : null,
      value: {
        latest_year: years[0] ?? null, years, end_date: details.end_date ?? null,
        employees: details.ratios?.employees != null ? Number(details.ratios.employees) : null,
        turnover: details.ratios?.turnover != null ? Number(details.ratios.turnover) : null,
        juridical_situation: details.juridical_situation?.description ?? null,
      },
      summary_nl: years[0]
        ? `Jaarrekening: laatste boekjaar ${years[0]}${details.ratios?.employees ? ` · ${Number(details.ratios.employees)} werknemers (VTE)` : ''}${details.end_date ? ` · einddatum ${String(details.end_date).slice(0, 10)}` : ''}`
        : 'Jaarrekening: geen neergelegde jaarrekeningen gevonden',
    }];
    if (latestPub) rows.push({
      enterprise_number: number, source, evidence_type: 'publication', url: latestPub.attachment_url ?? null, retrieved_at,
      observed_at: latestPub.date ?? null, value: { latest: latestPub, recent: pubs.slice(0, 5) },
      summary_nl: `Belgisch Staatsblad: laatste publicatie ${latestPub.date} — ${latestPub.title}`,
    });
    const { error } = await db.from('evidence').insert(rows);
    if (error) throw error;
    return { source, status: 'ok', message: years[0] ? `Laatste jaarrekening: boekjaar ${years[0]}` : 'Geen jaarrekeningen gevonden' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from('evidence').insert({ enterprise_number: number, source, evidence_type: 'error', value: { message }, summary_nl: `Jaarrekening.be niet beschikbaar: ${message}` }).then(() => {}, () => {});
    return { source, status: 'error', message };
  }
}

// ============================================================================
// Websitecheck — zwak bewijs. Technische fouten (certificaat, timeout) tellen NIET als "dood".
// ============================================================================
const GENERIC_MAIL = /(gmail|hotmail|outlook|live|yahoo|telenet|skynet|proximus|icloud|me\.com|msn|scarlet|pandora|belgacom|online\.be|base\.be|mail\.be|gmx|protonmail|orange|voo)\./i;
const CLOSED_TEXT = /(definitief gesloten|permanent gesloten|zaak is gesloten|we zijn gestopt|domain (is )?for sale|domein te koop|this domain is for sale|parked free)/i;

function normUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let s = u.trim().split(/[;\s]/)[0];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).origin + '/'; } catch { return null; }
}

export async function runWebsite(db: SupabaseClient, s: Subject, enterpriseNumber: string): Promise<StepResult> {
  const source = 'website';
  try {
    const col = s.subject_type === 'establishment' ? 'establishment_number' : 'enterprise_number';
    if (await hasRecentEvidence(db, source, col, s.number, 7)) return { source, status: 'cached', message: 'Websitecheck van de laatste 7 dagen hergebruikt' };

    const candidates = new Map<string, string>();
    const { data: ev } = await db.from('evidence').select('source,evidence_type,value,match_quality')
      .or(`${col}.eq.${s.number},and(enterprise_number.eq.${enterpriseNumber},establishment_number.is.null)`);
    for (const e of ev ?? []) {
      if (e.source === 'google_places' && e.evidence_type === 'website' && e.match_quality !== 'uncertain') { const u = normUrl(e.value?.website); if (u) candidates.set(u, 'Google Places'); }
      if (e.source === 'kbo_api' && e.value?.web) { const u = normUrl(e.value.web); if (u) candidates.set(u, 'KBO'); }
    }
    const emails: string[] = [];
    if (s.subject_type === 'establishment') {
      const { data } = await db.from('establishments').select('email').eq('establishment_number', s.number).single();
      if (data?.email) emails.push(data.email);
    }
    const { data: ent } = await db.from('enterprises').select('email').eq('enterprise_number', enterpriseNumber).single();
    if (ent?.email) emails.push(ent.email);
    for (const m of emails) {
      const d = m.split('@')[1]?.toLowerCase();
      if (d && !GENERIC_MAIL.test(d)) { const u = normUrl(d); if (u && !candidates.has(u)) candidates.set(u, 'e-maildomein'); }
    }
    if (!candidates.size) return { source, status: 'skipped', message: 'Geen website of eigen e-maildomein bekend' };

    const { data: muni } = s.subject_type === 'establishment'
      ? await db.from('establishments').select('kbo_municipality,kbo_postcode').eq('establishment_number', s.number).single()
      : await db.from('enterprises').select('kbo_municipality:seat_municipality,kbo_postcode:seat_postcode').eq('enterprise_number', s.number).single();
    const retrieved_at = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    for (const [url, origin] of [...candidates].slice(0, 3)) {
      let value: Record<string, unknown>;
      let summary: string;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Bedrijvenradar lokale economie)' } });
        const html = (await r.text()).slice(0, 300000);
        clearTimeout(to);
        const text = stripAccents(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
        const mentionsLocal = !!muni && ((muni.kbo_municipality && text.includes(stripAccents(muni.kbo_municipality))) || (muni.kbo_postcode && text.includes(muni.kbo_postcode)));
        const closed = text.match(CLOSED_TEXT)?.[0] ?? null;
        const outcome = closed ? 'closed_signal' : r.status >= 200 && r.status < 400 ? 'reachable' : [401, 403, 429].includes(r.status) ? 'blocked' : 'http_error';
        value = { url, origin, final_url: r.url, http_status: r.status, outcome, mentions_local: mentionsLocal, closed_text: closed };
        summary = {
          reachable: `Website ${url} bereikbaar (HTTP ${r.status})${mentionsLocal ? `, vermeldt ${muni?.kbo_municipality ?? 'de gemeente'}` : ''}`,
          blocked: `Website ${url} bestaat maar blokkeert automatische controle (HTTP ${r.status})`,
          http_error: `Website ${url} geeft een fout (HTTP ${r.status})`,
          closed_signal: `Website ${url} bevat signaal van sluiting/te koop: "${closed}"`,
        }[outcome]!;
      } catch (e) {
        const code = (e as any)?.name === 'AbortError' ? 'timeout' : String((e as any)?.message ?? e);
        const dns = /dns|name.*resolve|not known|ENOTFOUND|failed to lookup/i.test(code);
        value = { url, origin, outcome: dns ? 'domain_not_found' : 'technical_error', error: code.slice(0, 160) };
        summary = dns ? `Website ${url}: domein bestaat niet (meer)` : `Website ${url}: technisch niet te controleren (${code.slice(0, 60)}) — telt niet als bewijs`;
      }
      rows.push({ ...(s.subject_type === 'establishment' ? { establishment_number: s.number, enterprise_number: enterpriseNumber } : { enterprise_number: s.number }), source, evidence_type: 'website_check', url, retrieved_at, value, summary_nl: summary });
    }
    const { error } = await db.from('evidence').insert(rows);
    if (error) throw error;
    return { source, status: 'ok', message: `${rows.length} website(s) gecontroleerd` };
  } catch (e) {
    return { source, status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
