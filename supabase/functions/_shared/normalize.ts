// Pure helpers (geen Deno- of Node-API's): gedeeld door het importscript (Node) en Edge Functions (Deno).

/** VKBO gebruikt " " voor lege velden. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** 1900-01-01 en 9999-12-31 zijn placeholders ("niet ingevuld" / "open einde"). */
export function realDate(v: unknown): string | null {
  const s = clean(v);
  if (!s || s.startsWith('1900-01-01') || s.startsWith('9999-12-31')) return null;
  return s.slice(0, 10);
}

/** Telefoonnummers als 0000000000 zijn opvulwaarden. */
export function cleanPhone(v: unknown): string | null {
  const s = clean(v);
  if (!s || /^[0\s.+/-]+$/.test(s)) return null;
  return s;
}

export type LegalStatusNorm = 'normal' | 'liquidation' | 'bankruptcy' | 'dissolved' | 'reorganisation' | 'other' | 'unknown';

export function normalizeLegalStatus(v: unknown): LegalStatusNorm {
  const s = (clean(v) ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('normale toestand')) return 'normal';
  if (s.includes('faillissement')) return 'bankruptcy';
  if (s.includes('vereffening')) return 'liquidation';
  if (s.includes('ontbinding') || s.includes('nietigheid')) return 'dissolved';
  if (s.includes('reorganisatie') || s.includes('opschorting')) return 'reorganisation';
  return 'other';
}

export const LEGAL_STATUS_NL: Record<LegalStatusNorm, string> = {
  normal: 'normale toestand',
  liquidation: 'in vereffening',
  bankruptcy: 'in faillissement',
  dissolved: 'ontbonden',
  reorganisation: 'in gerechtelijke reorganisatie',
  other: 'andere rechtstoestand',
  unknown: 'onbekend',
};

export type GeoQuality = 'ok' | 'placeholder' | 'missing' | 'outside_municipality';

/** Bekende nep-coördinaat in de VKBO voor adressen die niet gegeocodeerd konden worden (ligt in Frankrijk). */
const PLACEHOLDER_POINTS: Array<[number, number]> = [[49.2933354, 2.30668925]];

export function geoQuality(lat: number | null, lon: number | null, bbox?: [number, number, number, number]): GeoQuality {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return 'missing';
  if (PLACEHOLDER_POINTS.some(([a, b]) => Math.abs(a - lat) < 1e-6 && Math.abs(b - lon) < 1e-6)) return 'placeholder';
  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return 'outside_municipality';
  }
  return 'ok';
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const LEGAL_FORM_WORDS = /\b(bv|bvba|nv|cv|cvba|commv|comm v|vof|vzw|srl|sprl|sa|sc|scrl|asbl|gcv|ltd|gmbh|besloten vennootschap|naamloze vennootschap)\b/g;
const STOPWORDS = new Set(['de', 'het', 'een', 'en', 'van', 'the', 'la', 'le', 'les', 'du', 'des', 'bij', 'in', 'op', 'schoten', 'belgium', 'belgie']);

export function nameTokens(s: string | null | undefined): string[] {
  return stripAccents(s ?? '')
    .replace(/[’'`]/g, '')
    .replace(LEGAL_FORM_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function trigrams(s: string): Set<string> {
  const t = ` ${s} `;
  const g = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}

/** Naamgelijkenis 0..1 (trigram-Dice, met bonus voor gedeelde woorden en inclusie). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const ja = ta.join('');
  const jb = tb.join('');
  if (ja === jb) return 1;
  if (ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja))) return 0.9;
  const ga = trigrams(ta.join(' '));
  const gb = trigrams(tb.join(' '));
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const dice = (2 * inter) / (ga.size + gb.size);
  const setA = new Set(ta);
  const shared = tb.filter((t) => setA.has(t) && t.length >= 4).length;
  return Math.max(dice, shared ? Math.min(0.85, 0.55 + 0.1 * shared) : 0);
}

export function streetKey(s: string | null | undefined): string {
  return stripAccents(s ?? '').replace(/[^a-z0-9]/g, '');
}

/** "133-135" → ["133","135"], "2A" → ["2a"], "ZN"/"-" → []. */
export function houseNumbers(h: string | null | undefined): string[] {
  const s = stripAccents(h ?? '').replace(/\s/g, '');
  const range = s.match(/^(\d+)-(\d+)$/);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (b >= a && b - a <= 20) return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
    return [range[1], range[2]];
  }
  const m = s.match(/^(\d+)([a-z]?)/);
  return m ? [m[1] + m[2], m[1]] : [];
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function kboPublicSearchUrl(number: string): string {
  return `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${number}`;
}

export function formatNumber(n: string): string {
  return n.length === 10 ? `${n.slice(0, 4)}.${n.slice(4, 7)}.${n.slice(7)}` : n;
}
