import type { Evidence } from '../lib/types';
import { formatDate, formatDateTime, MATCH_LABEL, MATCH_STYLE, SOURCE_LABEL, SOURCE_STYLE } from '../lib/labels';

export default function EvidenceList({ evidence, highlight }: { evidence: Evidence[]; highlight: string[] }) {
  if (evidence.length === 0) {
    return <p className="text-sm text-slate-500">Nog geen evidence. Haal KBO-gegevens op of zoek in Google Places.</p>;
  }
  return (
    <ul className="space-y-2">
      {evidence.map((e) => {
        const on = highlight.includes(e.id);
        return (
          <li key={e.id} id={`ev-${e.id}`} className={`rounded-md p-2.5 text-sm ring-1 transition ${on ? 'bg-yellow-50 ring-yellow-400' : 'ring-slate-100'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_STYLE[e.source] ?? 'bg-slate-100'}`}>{SOURCE_LABEL[e.source] ?? e.source}</span>
              <span className="text-xs text-slate-500">{e.evidence_type}</span>
              {e.establishment_number == null && e.enterprise_number && <span className="text-xs text-indigo-700">niveau onderneming</span>}
              {e.match_quality && <span className={`text-xs font-medium ${MATCH_STYLE[e.match_quality]}`}>{MATCH_LABEL[e.match_quality]}</span>}
            </div>
            <p className="mt-1 text-slate-800">{e.summary_nl}</p>
            {e.evidence_type === 'opening_hours' && Array.isArray(e.value?.weekday_descriptions) && (
              <ul className="mt-1 text-xs text-slate-600">{e.value.weekday_descriptions.map((d: string) => <li key={d}>{d}</li>)}</ul>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>Opgehaald {formatDateTime(e.retrieved_at)}</span>
              {e.observed_at && <span>Datum feit {formatDate(e.observed_at)}</span>}
              {e.source_record_id && <span>Bron-ID {e.source_record_id}</span>}
              {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Bron openen ↗</a>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
