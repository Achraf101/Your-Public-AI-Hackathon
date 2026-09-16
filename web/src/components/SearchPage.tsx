import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { invokeFunction, supabase } from '../lib/supabase';
import type { SearchResponse, SearchResult, SubjectType } from '../lib/types';
import { ACTIVITY_LABEL, CONFIDENCE_PLAIN, formatNumber, REGISTER_PLAIN } from '../lib/labels';
import { ConfidenceDots, ScoreBadge } from './Badges';

export type SearchState = { query: string; municipalityId: string; response: SearchResponse | null };

const EXAMPLES = ['Paalstraat', 'Enoks Schoenen', 'Paalstraat 205', '0452.609.522'];

const keyOf = (r: SearchResult) => `${r.subject_type}-${r.number}`;

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function SearchPage({ state, onChange, onOpen }: {
  state: SearchState; onChange: Dispatch<SetStateAction<SearchState>>; onOpen: (t: SubjectType, n: string) => void;
}) {
  const [municipalities, setMunicipalities] = useState<{ id: string; name: string; nis_code: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('municipalities').select('id,name,nis_code').order('name').then(({ data }) => {
      setMunicipalities(data ?? []);
      if (data?.length) {
        const fallback = data.find((m) => m.nis_code === '11040')?.id ?? data[0].id;
        onChange((prev) => (prev.municipalityId ? prev : { ...prev, municipalityId: fallback }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (query = state.query) => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setExported(null);
    onChange((prev) => ({ ...prev, query }));
    try {
      const response = await invokeFunction<SearchResponse>('search', { query, municipality_id: state.municipalityId });
      onChange((prev) => ({ ...prev, query, response }));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const results = state.response?.results ?? [];
  const muniName = municipalities.find((m) => m.id === state.municipalityId)?.name ?? '';
  const allSelected = results.length > 0 && results.every((r) => selected.has(keyOf(r)));
  const selectedRows = useMemo(() => results.filter((r) => selected.has(keyOf(r))), [results, selected]);

  const toggle = (r: SearchResult) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(keyOf(r))) next.delete(keyOf(r)); else next.add(keyOf(r));
    return next;
  });

  // Goedkeuring vóór publicatie: enkel de aangevinkte zaken worden geëxporteerd, en de export wordt gelogd.
  const exportSelected = async () => {
    if (!selectedRows.length || !state.response) return;
    const items = selectedRows.map((r) => ({
      naam: r.name, adres: r.address, postcode: r.postcode, gemeente: r.municipality,
      ondernemingsnummer: formatNumber(r.enterprise_number), register: REGISTER_PLAIN[r.legal_status_norm] ?? r.legal_status_norm,
      score: r.score, beoordeling: ACTIVITY_LABEL[r.label] ?? r.label, zekerheid: CONFIDENCE_PLAIN[r.confidence]?.short ?? r.confidence,
    }));
    await supabase.from('exports').insert({ search: state.response.interpreted, item_count: items.length, items });
    const header = ['Naam', 'Adres', 'Postcode', 'Gemeente', 'Ondernemingsnummer', 'Register', 'Score', 'Beoordeling', 'Zekerheid'];
    const lines = [header.join(';'), ...items.map((i) => [i.naam, i.adres, i.postcode, i.gemeente, i.ondernemingsnummer, i.register, i.score, i.beoordeling, i.zekerheid].map(csvCell).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bedrijvenradar-${state.response.interpreted.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExported(`${items.length} zaken geëxporteerd naar Excel.`);
  };

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Zoek een zaak of straat</h1>
        <p className="mt-1 text-slate-600">Typ een straatnaam, een adres, de naam van een zaak of een ondernemingsnummer.</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-2">
          <select
            value={state.municipalityId}
            onChange={(e) => onChange({ ...state, municipalityId: e.target.value, response: null })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5"
            aria-label="Gemeente"
          >
            {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder="bv. Paalstraat, Enoks Schoenen of 0452.609.522"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none"
            autoFocus
          />
          <button type="submit" disabled={loading} className="rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {loading ? 'Zoeken…' : 'Zoeken'}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Probeer:{' '}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              <button type="button" className="text-sky-700 hover:underline" onClick={() => run(ex)}>{ex}</button>
              {i < EXAMPLES.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </form>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
      {loading && !state.response && <p className="text-slate-500">Zaken worden opgezocht…</p>}

      {state.response && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{state.response.count} {state.response.count === 1 ? 'zaak' : 'zaken'} — {state.response.interpreted}</h2>
              {(state.response.hidden_low > 0 || state.response.hidden_noise > 0) && (
                <p className="text-sm text-slate-500">
                  {state.response.hidden_low > 0 && <>{state.response.hidden_low} zaken met een score onder {state.response.min_score} zijn weggelaten (waarschijnlijk gestopt). </>}
                  {state.response.hidden_noise > 0 && <>{state.response.hidden_noise} registraties zonder handelszaak (zoals verenigingen van mede-eigenaars) zijn weggelaten.</>}
                </p>
              )}
              {state.response.truncated && <p className="text-sm text-amber-700">Er zijn meer resultaten dan getoond: maak de zoekopdracht specifieker.</p>}
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-3">
                {exported && <span className="text-sm text-emerald-700">{exported}</span>}
                <button
                  onClick={exportSelected}
                  disabled={!selectedRows.length}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  title="Enkel de aangevinkte zaken worden geëxporteerd"
                >
                  Exporteer {selectedRows.length || ''} aangevinkte {selectedRows.length === 1 ? 'zaak' : 'zaken'} naar Excel
                </button>
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <p className="rounded-xl bg-white p-6 text-center text-slate-600 ring-1 ring-slate-200">
              Geen zaken gevonden in {muniName}. Controleer de schrijfwijze of kies een andere gemeente.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Alles aanvinken"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(results.map(keyOf)))}
                      />
                    </th>
                    <th className="px-3 py-3">Naam</th>
                    <th className="px-3 py-3">Adres</th>
                    <th className="px-3 py-3">Ondernemingsnummer</th>
                    <th className="px-3 py-3">Register</th>
                    <th className="px-3 py-3">Score</th>
                    <th className="px-3 py-3">Zekerheid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r) => (
                    <tr key={keyOf(r)} className="cursor-pointer hover:bg-sky-50/60" onClick={() => onOpen(r.subject_type, r.number)}>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`${r.name} aanvinken`} checked={selected.has(keyOf(r))} onChange={() => toggle(r)} />
                      </td>
                      <td className="px-3 py-3 font-medium">{r.name ?? 'Naam onbekend'}</td>
                      <td className="px-3 py-3">
                        {r.address}
                        {!r.in_municipality && <span className="ml-1 text-xs text-slate-500">({r.municipality})</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">{formatNumber(r.enterprise_number)}</td>
                      <td className={`whitespace-nowrap px-3 py-3 ${r.legal_status_norm === 'normal' || r.legal_status_norm === 'unknown' ? 'text-slate-600' : 'font-medium text-rose-700'}`}>
                        {REGISTER_PLAIN[r.legal_status_norm] ?? r.legal_status_norm}
                      </td>
                      <td className="px-3 py-3"><ScoreBadge score={r.score} label={r.label} /></td>
                      <td className="whitespace-nowrap px-3 py-3"><ConfidenceDots confidence={r.confidence} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {results.some((r) => r.score_basis === 'register') && (
            <p className="text-xs text-slate-500">Scores in de lijst zijn eerst gebaseerd op het register. Open een zaak voor een volledige controle.</p>
          )}
        </div>
      )}
    </section>
  );
}
