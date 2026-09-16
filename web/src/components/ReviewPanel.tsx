import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Analysis, ProposedStatus, Review } from '../lib/types';
import { ACTIVITY_LABEL, ACTIVITY_STYLE, formatDateTime, STATUS_LABEL } from '../lib/labels';
import { ConfidenceBadge, StatusBadge } from './Badges';

const EFFECT_STYLE: Record<string, string> = {
  supports_active: 'border-emerald-400',
  supports_inactive: 'border-rose-400',
  conflict: 'border-orange-400',
  uncertainty: 'border-slate-300',
  info: 'border-sky-300',
};
const EFFECT_LABEL: Record<string, string> = {
  supports_active: 'wijst op activiteit',
  supports_inactive: 'wijst op inactiviteit',
  conflict: 'conflict',
  uncertainty: 'onzekerheid',
  info: 'info',
};

export default function ReviewPanel({ analysis, reviews, reviewer, onHighlight, onReviewed }: {
  analysis: Analysis | null; reviews: Review[]; reviewer: string;
  onHighlight: (ids: string[]) => void; onReviewed: () => void;
}) {
  const [comment, setComment] = useState('');
  const [finalStatus, setFinalStatus] = useState<ProposedStatus | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!analysis) {
    return (
      <section className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Voorstel</h2>
        <p className="mt-2 text-sm text-slate-600">Nog geen score. Klik op <strong>Controleer activiteit</strong>.</p>
      </section>
    );
  }

  const submit = async (decision: 'confirmed' | 'rejected') => {
    setError(null);
    if (!reviewer.trim()) { setError('Vul bovenaan uw naam in als medewerker.'); return; }
    if (decision === 'rejected' && !comment.trim()) { setError('Geef kort aan waarom u het voorstel afwijst.'); return; }
    setSaving(true);
    const { error } = await supabase.from('officer_reviews').insert({
      analysis_id: analysis.id, decision, reviewer: reviewer.trim(),
      comment: comment.trim() || null, final_status: finalStatus || null,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setComment('');
    setFinalStatus('');
    onReviewed();
  };

  return (
    <section className="sticky top-4 space-y-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Activiteit</h2>
        {analysis.activity_score != null && analysis.activity_label ? (
          <div className={`mt-2 rounded-md p-3 ${ACTIVITY_STYLE[analysis.activity_label].bg}`}>
            <div className="flex items-baseline gap-2">
              <span className={`text-4xl font-semibold tabular-nums ${ACTIVITY_STYLE[analysis.activity_label].text}`}>{analysis.activity_score}</span>
              <span className="text-sm text-slate-500">/100</span>
              <span className={`text-lg font-medium ${ACTIVITY_STYLE[analysis.activity_label].text}`}>{ACTIVITY_LABEL[analysis.activity_label]}</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-white/70">
              <div className={`h-2 rounded-full ${ACTIVITY_STYLE[analysis.activity_label].bar}`} style={{ width: `${analysis.activity_score}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>Zekerheid</span>
              <ConfidenceBadge confidence={analysis.confidence} />
              <span className="ml-auto">Voorstel:</span>
              <StatusBadge status={analysis.proposed_status} />
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={analysis.proposed_status} />
            <ConfidenceBadge confidence={analysis.confidence} />
          </div>
        )}
        <p className="mt-2 text-sm text-slate-800">{analysis.summary_nl}</p>
        <p className="mt-1 text-xs text-slate-400">Model {analysis.model_version} · {formatDateTime(analysis.created_at)}</p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Waarop gebaseerd {analysis.activity_score != null && <span className="font-normal normal-case text-slate-400">(start 50 + punten)</span>}</h3>
        <ul className="mt-2 space-y-1.5">
          {analysis.reasons.map((r, i) => (
            <li
              key={i}
              onMouseEnter={() => onHighlight(r.evidence_ids)}
              onMouseLeave={() => onHighlight([])}
              onClick={() => r.evidence_ids[0] && document.getElementById(`ev-${r.evidence_ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className={`cursor-default border-l-4 pl-2 text-sm ${EFFECT_STYLE[r.effect] ?? 'border-slate-200'} ${r.evidence_ids.length ? 'cursor-pointer' : ''}`}
            >
              {r.points != null && r.points !== 0 && (
                <span className={`mr-1 inline-block w-9 text-right font-mono text-xs font-semibold ${r.points > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{r.points > 0 ? `+${r.points}` : r.points}</span>
              )}
              <span className="text-slate-800">{r.text_nl}</span>
              <span className="ml-1 text-xs text-slate-400">({EFFECT_LABEL[r.effect] ?? r.effect}{r.evidence_ids.length ? ` · ${r.evidence_ids.length} evidence` : ''})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uw beslissing</h3>
        <select
          value={finalStatus}
          onChange={(e) => setFinalStatus(e.target.value as ProposedStatus | '')}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">Status zoals voorgesteld</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>Status aanpassen: {v}</option>)}
        </select>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Opmerking (verplicht bij afwijzen), bv. 'terreinbezoek 16/09: rolluik dicht'"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => submit('confirmed')} disabled={saving} className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            Bevestigen
          </button>
          <button onClick={() => submit('rejected')} disabled={saving} className="flex-1 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
            Afwijzen
          </button>
        </div>
        <p className="text-xs text-slate-400">Enkel bevestigde voorstellen verlaten de tool.</p>
      </div>

      {reviews.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historiek</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {reviews.map((r) => (
              <li key={r.id}>
                <span className={r.decision === 'confirmed' ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
                  {r.decision === 'confirmed' ? '✓ Bevestigd' : '✕ Afgewezen'}
                </span>
                {r.final_status && <span className="text-slate-600"> → {STATUS_LABEL[r.final_status]}</span>}
                <span className="text-xs text-slate-500"> · {r.reviewer} · {formatDateTime(r.reviewed_at)}</span>
                {r.comment && <p className="text-xs text-slate-600">“{r.comment}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
