import type { Confidence, ProposedStatus } from './types';

export const STATUS_LABEL: Record<ProposedStatus, string> = {
  active_likely: 'Waarschijnlijk actief',
  temporarily_closed: 'Tijdelijk gesloten',
  possibly_inactive: 'Mogelijk niet meer actief',
  conflict_manual_check: 'Conflict — manuele controle',
  address_issue: 'Adresprobleem',
  insufficient_evidence: 'Onvoldoende bewijs',
};

export const STATUS_STYLE: Record<ProposedStatus, string> = {
  active_likely: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  temporarily_closed: 'bg-amber-50 text-amber-800 ring-amber-200',
  possibly_inactive: 'bg-rose-50 text-rose-800 ring-rose-200',
  conflict_manual_check: 'bg-orange-50 text-orange-800 ring-orange-300',
  address_issue: 'bg-violet-50 text-violet-800 ring-violet-200',
  insufficient_evidence: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { HIGH: 'Hoog', MEDIUM: 'Middel', LOW: 'Laag' };
export const CONFIDENCE_STYLE: Record<Confidence, string> = {
  HIGH: 'bg-emerald-600 text-white',
  MEDIUM: 'bg-amber-500 text-white',
  LOW: 'bg-slate-500 text-white',
};

export const LEGAL_LABEL: Record<string, string> = {
  normal: 'Normale toestand',
  liquidation: 'In vereffening',
  bankruptcy: 'Faillissement',
  dissolved: 'Ontbonden',
  reorganisation: 'Gerechtelijke reorganisatie',
  other: 'Andere toestand',
  unknown: 'Onbekend',
};

export const SOURCE_LABEL: Record<string, string> = {
  vkbo: 'VKBO (register)',
  kbo_api: 'KBO API',
  google_places: 'Google Places',
  jaarrekening: 'Jaarrekening.be',
  website: 'Website',
  officer: 'Medewerker',
};

export const SOURCE_STYLE: Record<string, string> = {
  vkbo: 'bg-sky-100 text-sky-800',
  kbo_api: 'bg-indigo-100 text-indigo-800',
  google_places: 'bg-teal-100 text-teal-800',
  jaarrekening: 'bg-fuchsia-100 text-fuchsia-800',
  website: 'bg-amber-100 text-amber-800',
  officer: 'bg-slate-200 text-slate-800',
};

export const MATCH_LABEL: Record<string, string> = { exact: 'Exacte match', probable: 'Waarschijnlijke match', uncertain: 'Onzekere match' };
export const MATCH_STYLE: Record<string, string> = {
  exact: 'text-emerald-700',
  probable: 'text-amber-700',
  uncertain: 'text-rose-700',
};

export function formatNumber(n: string | null | undefined): string {
  if (!n) return '—';
  return n.length === 10 ? `${n.slice(0, 4)}.${n.slice(4, 7)}.${n.slice(7)}` : n;
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('nl-BE');
}

export function houseSortKey(h: string | null): number {
  const m = (h ?? '').match(/\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

export const ACTIVITY_LABEL: Record<string, string> = {
  active: 'Actief',
  likely_active: 'Waarschijnlijk actief',
  uncertain: 'Onzeker',
  likely_inactive: 'Waarschijnlijk inactief',
  inactive: 'Inactief',
};

export const ACTIVITY_STYLE: Record<string, { text: string; bar: string; bg: string }> = {
  active: { text: 'text-emerald-700', bar: 'bg-emerald-500', bg: 'bg-emerald-50' },
  likely_active: { text: 'text-emerald-700', bar: 'bg-emerald-400', bg: 'bg-emerald-50' },
  uncertain: { text: 'text-slate-700', bar: 'bg-slate-400', bg: 'bg-slate-100' },
  likely_inactive: { text: 'text-rose-700', bar: 'bg-rose-400', bg: 'bg-rose-50' },
  inactive: { text: 'text-rose-800', bar: 'bg-rose-600', bg: 'bg-rose-50' },
};

export const STEP_STATUS: Record<string, { label: string; style: string }> = {
  ok: { label: 'opgehaald', style: 'text-emerald-700' },
  cached: { label: 'uit cache', style: 'text-sky-700' },
  skipped: { label: 'overgeslagen', style: 'text-slate-500' },
  limit: { label: 'limiet', style: 'text-amber-700' },
  error: { label: 'fout', style: 'text-rose-700' },
};
