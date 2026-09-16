import type { Evidence } from '../lib/types';
import { formatDate, formatDateTime, SOURCE_LABEL, SOURCE_STYLE } from '../lib/labels';

// Volledige lijst bewijsstukken (ingeklapt op de detailpagina), voor wie wil nakijken waar een conclusie vandaan komt.
export default function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-slate-500">Nog geen bewijsstukken.</p>;
  return (
    <ul className="space-y-2">
      {evidence.map((e) => (
        <li key={e.id} className="rounded-lg p-2.5 text-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_STYLE[e.source] ?? 'bg-slate-100'}`}>{SOURCE_LABEL[e.source] ?? e.source}</span>
            {e.match_quality === 'uncertain' && <span className="text-xs text-slate-500">niet zeker dezelfde zaak — niet meegeteld</span>}
          </div>
          <p className="mt-1 text-slate-800">{e.summary_nl}</p>
          {e.evidence_type === 'opening_hours' && Array.isArray(e.value?.weekday_descriptions) && (
            <ul className="mt-1 text-xs text-slate-600">{e.value.weekday_descriptions.map((d: string) => <li key={d}>{d}</li>)}</ul>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span>Opgehaald {formatDateTime(e.retrieved_at)}</span>
            {e.observed_at && <span>Datum {formatDate(e.observed_at)}</span>}
            {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Bron openen ↗</a>}
          </div>
        </li>
      ))}
    </ul>
  );
}
