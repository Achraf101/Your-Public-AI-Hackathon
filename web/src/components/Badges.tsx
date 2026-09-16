import type { ActivityLabel, Confidence } from '../lib/types';
import { ACTIVITY_LABEL, ACTIVITY_STYLE, CONFIDENCE_PLAIN } from '../lib/labels';

/** Compacte score: getal + label + balk. */
export function ScoreBadge({ score, label }: { score: number | null | undefined; label: ActivityLabel | null | undefined }) {
  if (score == null || !label) return <span className="text-xs text-slate-400">—</span>;
  const s = ACTIVITY_STYLE[label];
  return (
    <div className="min-w-[10rem]">
      <div className="flex items-baseline gap-1.5">
        <span className={`font-semibold tabular-nums ${s.text}`}>{score}</span>
        <span className="text-xs text-slate-400">/100</span>
        <span className={`text-xs font-medium ${s.text}`}>{ACTIVITY_LABEL[label]}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
        <div className={`h-1.5 rounded-full ${s.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

/** Zekerheid als bolletjes + woord (geen HIGH/MEDIUM/LOW). */
export function ConfidenceDots({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) return <span className="text-xs text-slate-400">—</span>;
  const c = CONFIDENCE_PLAIN[confidence];
  return (
    <span className="inline-flex items-center gap-1.5" title={c.long}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i <= c.dots ? 'bg-slate-700' : 'bg-slate-200'}`} />
        ))}
      </span>
      <span className="text-xs text-slate-700">{c.short}</span>
    </span>
  );
}
