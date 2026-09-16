import type { ActivityLabel, Confidence, ProposedStatus } from '../lib/types';
import { ACTIVITY_LABEL, ACTIVITY_STYLE, CONFIDENCE_LABEL, CONFIDENCE_STYLE, STATUS_LABEL, STATUS_STYLE } from '../lib/labels';

export function StatusBadge({ status }: { status: ProposedStatus | null }) {
  if (!status) return <span className="text-xs text-slate-400">Nog geen voorstel</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence | null }) {
  if (!confidence) return <span className="text-xs text-slate-400">—</span>;
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLE[confidence]}`}>{CONFIDENCE_LABEL[confidence]}</span>;
}

export function DecisionBadge({ decision }: { decision: 'confirmed' | 'rejected' | null }) {
  if (!decision) return <span className="text-xs text-slate-400">Te beoordelen</span>;
  return decision === 'confirmed'
    ? <span className="text-xs font-medium text-emerald-700">✓ Bevestigd</span>
    : <span className="text-xs font-medium text-rose-700">✕ Afgewezen</span>;
}

/** Compacte score: balk + getal + label. */
export function ScoreBadge({ score, label }: { score: number | null | undefined; label: ActivityLabel | null | undefined }) {
  if (score == null || !label) return <span className="text-xs text-slate-400">Niet gecontroleerd</span>;
  const s = ACTIVITY_STYLE[label];
  return (
    <div className="min-w-[9rem]">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-sm font-semibold tabular-nums ${s.text}`}>{score}</span>
        <span className="text-xs text-slate-400">/100</span>
        <span className={`text-xs font-medium ${s.text}`}>{ACTIVITY_LABEL[label]}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
        <div className={`h-1.5 rounded-full ${s.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
