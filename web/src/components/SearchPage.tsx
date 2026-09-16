import { useEffect, useState } from 'react';
import { invokeFunction, supabase } from '../lib/supabase';
import type { SearchResult, SubjectType } from '../lib/types';
import { formatDateTime, formatNumber, LEGAL_LABEL } from '../lib/labels';
import { ConfidenceBadge, ScoreBadge } from './Badges';

type Mode = 'auto' | 'name' | 'address' | 'number';
type SearchResponse = { mode: string; interpreted: string; source: string; retrieved_at: string; count: number; results: SearchResult[]; notes: string[] };
export type SearchState = { query: string; mode: Mode; municipalityId: string; response: SearchResponse | null };

const MODES: { id: Mode; label: string }[] = [
  { id: 'auto', label: 'Automatisch' },
  { id: 'name', label: 'Naam' },
  { id: 'address', label: 'Adres' },
  { id: 'number', label: 'Ondernemingsnummer' },
];

const EXAMPLES = ['Enoks Schoenen', 'Paalstraat 205', '0452.609.522', 'kapsalon'];

export default function SearchPage({ state, onChange, onOpen }: {
  state: SearchState; onChange: (s: SearchState) => void; onOpen: (t: SubjectType, n: string) => void;
}) {
  const [municipalities, setMunicipalities] = useState<{ id: string; name: string; nis_code: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyLocal, setOnlyLocal] = useState(true);

  useEffect(() => {
    supabase.from('municipalities').select('id,name,nis_code').order('name').then(({ data }) => {
      setMunicipalities(data ?? []);
      if (!state.municipalityId && data?.length) {
        onChange({ ...state, municipalityId: data.find((m) => m.nis_code === '11040')?.id ?? data[0].id });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (query = state.query) => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const response = await invokeFunction<SearchResponse>('search', { query, mode: state.mode, municipality_id: state.municipalityId });
      onChange({ ...state, query, response });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const results = (state.response?.results ?? []).filter((r) => !onlyLocal || r.in_municipality || state.response?.mode === 'number');
  const hidden = (state.response?.results.length ?? 0) - results.length;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Zoek een zaak</h1>
        <p className="mt-1 text-sm text-slate-600">
          Zoek op naam, adres of ondernemingsnummer. Open een resultaat om de activiteit te controleren met register, jaarrekening, website en Google Places.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-2">
          <select
            value={state.municipalityId}
            onChange={(e) => onChange({ ...state, municipalityId: e.target.value, response: null })}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
            aria-label="Gemeente"
          >
            {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder="bv. Enoks Schoenen · Paalstraat 53 · 0452.609.522"
            className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-2 focus:border-sky-500 focus:outline-none"
            autoFocus
          />
          <button type="submit" disabled={loading} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {loading ? 'Zoeken…' : 'Zoeken'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Zoeken op:</span>
          {MODES.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => onChange({ ...state, mode: m.id })}
              className={`rounded-full px-3 py-0.5 ring-1 ${state.mode === m.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-500'}`}
            >
              {m.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-400">
            Voorbeelden: {EXAMPLES.map((ex, i) => (
              <button type="button" key={ex} className="text-sky-700 hover:underline" onClick={() => run(ex)}>{ex}{i < EXAMPLES.length - 1 ? ', ' : ''}</button>
            ))}
          </span>
        </div>
      </form>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {state.response && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <p>
              <strong>{state.response.count}</strong> resultaten voor {state.response.interpreted} · bron {state.response.source}, opgehaald {formatDateTime(state.response.retrieved_at)}
            </p>
            {state.response.mode !== 'number' && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={onlyLocal} onChange={(e) => setOnlyLocal(e.target.checked)} />
                Enkel binnen de gemeente {hidden > 0 && `(${hidden} verborgen)`}
              </label>
            )}
          </div>
          {state.response.notes.map((n) => <p key={n} className="text-xs text-amber-700">{n}</p>)}

          <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Naam</th>
                  <th className="px-3 py-2">Adres</th>
                  <th className="px-3 py-2">Register</th>
                  <th className="px-3 py-2">Activiteitsscore</th>
                  <th className="px-3 py-2">Zekerheid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((r) => (
                  <tr key={`${r.subject_type}-${r.number}`} onClick={() => onOpen(r.subject_type, r.number)} className="cursor-pointer hover:bg-sky-50/60">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{r.name ?? '—'}</div>
                      <div className="text-xs text-slate-500">
                        {r.subject_type === 'establishment' ? 'Vestiging' : 'Onderneming'} {formatNumber(r.number)}
                        {r.subject_type === 'establishment' && (
                          <> · van {r.enterprise_completeness === 'number_only' ? formatNumber(r.enterprise_number) : r.enterprise_name ?? formatNumber(r.enterprise_number)}</>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {r.address}
                      <div className="text-xs text-slate-500">
                        {r.postcode} {r.municipality}
                        {!r.in_municipality && <span className="ml-1 rounded bg-slate-100 px-1">buiten gemeente</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                      {r.enterprise_completeness === 'number_only' ? <span className="text-slate-400">Nog niet opgehaald</span> : (
                        <span className={r.legal_status_norm === 'normal' ? 'text-slate-700' : 'font-medium text-rose-700'}>{LEGAL_LABEL[r.legal_status_norm] ?? r.legal_status_norm}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top"><ScoreBadge score={r.analysis?.activity_score} label={r.analysis?.activity_label} /></td>
                    <td className="px-3 py-2 align-top">{r.analysis?.activity_score != null ? <ConfidenceBadge confidence={r.analysis.confidence} /> : <span className="text-xs text-slate-400">—</span>}</td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Geen resultaten. Probeer een andere schrijfwijze of zoekwijze.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
