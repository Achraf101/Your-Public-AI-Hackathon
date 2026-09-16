import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeFunction, supabase } from '../lib/supabase';
import type { Analysis, Evidence, Review, StepResult, SubjectType } from '../lib/types';
import { formatDate, formatNumber, LEGAL_LABEL, SOURCE_LABEL, STEP_STATUS } from '../lib/labels';
import EvidenceList from './EvidenceList';
import ReviewPanel from './ReviewPanel';

type Props = { subjectType: SubjectType; number: string; reviewer: string; onOpen: (t: SubjectType, n: string) => void };

const KBO_PUBLIC = (n: string) => `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${n}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children ?? <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Card({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function RecordDetail({ subjectType, number, reviewer, onOpen }: Props) {
  const [establishment, setEstablishment] = useState<any>(null);
  const [enterprise, setEnterprise] = useState<any>(null);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepResult[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    let est: any = null;
    let entNr = number;
    if (subjectType === 'establishment') {
      const { data } = await supabase.from('establishments').select('*').eq('establishment_number', number).single();
      est = data;
      entNr = data?.enterprise_number;
    }
    const [ent, sib, ev, an] = await Promise.all([
      supabase.from('enterprises').select('*').eq('enterprise_number', entNr).single(),
      supabase.from('establishments').select('establishment_number,commercial_name,name,kbo_street,kbo_house_number,kbo_municipality').eq('enterprise_number', entNr),
      subjectType === 'establishment'
        ? supabase.from('evidence').select('*').or(`establishment_number.eq.${number},and(enterprise_number.eq.${entNr},establishment_number.is.null)`).order('retrieved_at', { ascending: false })
        : supabase.from('evidence').select('*').eq('enterprise_number', number).is('establishment_number', null).order('retrieved_at', { ascending: false }),
      supabase.from('analysis').select('*').eq(subjectType === 'establishment' ? 'establishment_number' : 'enterprise_number', number)
        .eq('subject_type', subjectType).eq('is_current', true).maybeSingle(),
    ]);
    setEstablishment(est);
    setEnterprise(ent.data);
    setSiblings((sib.data ?? []).filter((s) => s.establishment_number !== number));
    setEvidence((ev.data ?? []) as Evidence[]);
    setAnalysis(an.data as Analysis | null);
    if (an.data) {
      const { data: rv } = await supabase.from('officer_reviews').select('*').eq('analysis_id', an.data.id).order('reviewed_at', { ascending: false });
      setReviews((rv ?? []) as Review[]);
    } else {
      setReviews([]);
    }
    setLoaded(true);
  }, [subjectType, number]);

  useEffect(() => { load(); }, [load]);

  const check = async (includeGoogle: boolean) => {
    if (includeGoogle && !window.confirm('Google Places opvragen? Dit telt tegen de gratis limiet (max. 900 per maand). Recente resultaten komen uit de cache en kosten niets.')) return;
    setBusy(includeGoogle ? 'google' : 'check');
    setMessage(null);
    try {
      const r = await invokeFunction<{ steps: StepResult[] }>('check-activity', { subject_type: subjectType, number, include_google: includeGoogle });
      setSteps(r.steps);
      await load();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // Bij openen: gratis bronnen automatisch controleren als er nog geen (v2-)score is. Google enkel via knop.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!loaded || autoChecked.current) return;
    autoChecked.current = true;
    if (!analysis || analysis.activity_score == null) check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const displayName = subjectType === 'establishment'
    ? establishment?.commercial_name ?? establishment?.name
    : enterprise?.commercial_name ?? enterprise?.name;

  const differences = useMemo(() => buildDifferences(establishment, enterprise, evidence), [establishment, enterprise, evidence]);

  if (!enterprise) return <p className="text-sm text-slate-500">Laden…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{subjectType === 'establishment' ? 'Vestigingseenheid' : 'Onderneming'} {formatNumber(number)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{displayName ?? 'Naam onbekend'}</h1>
          <p className="text-sm text-slate-600">
            {subjectType === 'establishment'
              ? `${establishment?.kbo_street ?? ''} ${establishment?.kbo_house_number ?? ''}${establishment?.kbo_box ? ` bus ${establishment.kbo_box}` : ''}, ${establishment?.kbo_postcode ?? ''} ${establishment?.kbo_municipality ?? ''}`
              : `${enterprise.seat_street ?? ''} ${enterprise.seat_house_number ?? ''}, ${enterprise.seat_postcode ?? ''} ${enterprise.seat_municipality ?? ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => check(false)} disabled={!!busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {busy === 'check' ? 'Bronnen controleren…' : 'Controleer activiteit'}
          </button>
          <button onClick={() => check(true)} disabled={!!busy} className="rounded-md bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300 hover:ring-teal-400 disabled:opacity-50">
            {busy === 'google' ? 'Bezig…' : '+ Google Places controleren'}
          </button>
        </div>
      </div>

      {busy === 'check' && !steps && (
        <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-800">Register, KBO, jaarrekening en website worden gecontroleerd…</p>
      )}
      {steps && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
          <span className="font-semibold text-slate-500">Laatste controle:</span>
          {steps.map((st) => (
            <span key={st.source} title={st.message}>
              {SOURCE_LABEL[st.source] ?? st.source}: <span className={STEP_STATUS[st.status]?.style}>{STEP_STATUS[st.status]?.label ?? st.status}</span>
              <span className="text-slate-400"> — {st.message}</span>
            </span>
          ))}
        </div>
      )}

      {message && (
        <p className={`rounded-md p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        <div className="space-y-4">
          <Card title="Register: onderneming en vestiging">
            <div className="grid gap-4 md:grid-cols-2">
              {establishment && (
                <div className="rounded-md bg-sky-50/60 p-3 ring-1 ring-sky-100">
                  <p className="mb-1 text-xs font-semibold text-sky-800">Vestiging (fysieke plaats)</p>
                  <dl>
                    <Field label="Nummer">{formatNumber(establishment.establishment_number)}</Field>
                    <Field label="Naam">{establishment.name}</Field>
                    <Field label="Handelsnaam">{establishment.commercial_name}</Field>
                    <Field label="Startdatum">{formatDate(establishment.start_date)}</Field>
                    <Field label="Activiteit (RSZ)">{establishment.nace_rsz ? `${establishment.nace_rsz} — ${establishment.nace_rsz_description}` : null}</Field>
                    <Field label="Bron">VKBO · opgehaald {formatDate(establishment.source_retrieved_at)}</Field>
                  </dl>
                </div>
              )}
              <div className="rounded-md bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
                <p className="mb-1 text-xs font-semibold text-indigo-800">
                  Onderneming (juridische entiteit){subjectType === 'establishment' ? ' — moeder van deze vestiging' : ''}
                </p>
                {enterprise.completeness === 'number_only' ? (
                  <div className="space-y-2 text-sm">
                    <p><strong>{formatNumber(enterprise.enterprise_number)}</strong></p>
                    <p className="text-amber-800">Enkel het nummer is bekend (niet in de VKBO, vaak een eenmanszaak). Klik op Controleer activiteit om de KBO-gegevens op te halen.</p>
                  </div>
                ) : (
                  <dl>
                    <Field label="Nummer">
                      <a className="text-sky-700 hover:underline" href={KBO_PUBLIC(enterprise.enterprise_number)} target="_blank" rel="noreferrer">{formatNumber(enterprise.enterprise_number)} ↗</a>
                    </Field>
                    <Field label="Naam">{enterprise.name}</Field>
                    <Field label="Type">{{ legal_person: 'Rechtspersoon', natural_person: 'Natuurlijke persoon', unknown: null }[enterprise.entity_type as string]}</Field>
                    <Field label="Rechtsvorm">{enterprise.legal_form}</Field>
                    <Field label="Rechtstoestand">
                      <span className={enterprise.legal_status_norm === 'normal' ? '' : 'font-medium text-rose-700'}>{enterprise.legal_status ?? LEGAL_LABEL[enterprise.legal_status_norm]}</span>
                    </Field>
                    <Field label="Zetel">
                      {[enterprise.seat_street, enterprise.seat_house_number, enterprise.seat_postcode, enterprise.seat_municipality].filter(Boolean).join(' ') || null}
                      {subjectType === 'establishment' && enterprise.seat_municipality && establishment?.kbo_municipality !== enterprise.seat_municipality && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">zetel elders</span>
                      )}
                    </Field>
                    <Field label="Hoofdactiviteit">{enterprise.nace_main ? `${enterprise.nace_main} — ${enterprise.nace_main_description}` : null}</Field>
                    <Field label="Bron">{enterprise.source === 'kbo_api' ? 'KBO API' : 'VKBO'} · opgehaald {formatDate(enterprise.source_retrieved_at)}</Field>
                  </dl>
                )}
              </div>
            </div>
            {siblings.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="text-slate-500">Andere vestigingen van deze onderneming in de data:</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {siblings.map((s) => (
                    <li key={s.establishment_number}>
                      <button onClick={() => onOpen('establishment', s.establishment_number)} className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200">
                        {s.commercial_name ?? s.name} · {s.kbo_street} {s.kbo_house_number}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Verschillen tussen bronnen">
            {differences.length === 0 ? (
              <p className="text-sm text-slate-500">Geen verschillen gevonden in de beschikbare evidence. Dat betekent niet dat alles klopt: controleer of er externe evidence is.</p>
            ) : (
              <ul className="space-y-2">
                {differences.map((d, i) => (
                  <li key={i} className="rounded-md bg-amber-50 p-2 text-sm ring-1 ring-amber-100">
                    <p className="font-medium text-amber-900">{d.title}</p>
                    <p className="text-amber-900/80">{d.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ContactCard establishment={establishment} enterprise={enterprise} evidence={evidence} />

          <Card title={`Evidence (${evidence.length})`}>
            <EvidenceList evidence={evidence} highlight={highlight} />
          </Card>
        </div>

        <div className="space-y-4">
          <ReviewPanel
            analysis={analysis}
            reviews={reviews}
            reviewer={reviewer}
            onHighlight={setHighlight}
            onReviewed={load}
          />
        </div>
      </div>
    </div>
  );
}

function buildDifferences(est: any, ent: any, evidence: Evidence[]) {
  const out: { title: string; detail: string }[] = [];
  if (est?.address_mismatch) {
    out.push({
      title: 'KBO-adres ≠ adressenregister',
      detail: `KBO: ${[est.kbo_street, est.kbo_house_number, est.kbo_box].filter(Boolean).join(' ')} · Adressenregister: ${[est.ar_street, est.ar_house_number, est.ar_box].filter(Boolean).join(' ') || 'leeg'}`,
    });
  }
  const geo = est?.geo_quality ?? ent?.seat_geo_quality;
  if (geo && geo !== 'ok') {
    out.push({ title: 'Coördinaat niet bruikbaar', detail: `Kwaliteit: ${geo}. De afstand tot Google-resultaten kan niet gecontroleerd worden.` });
  }
  const latestGoogle = evidence.find((e) => e.source === 'google_places' && e.evidence_type === 'place_match' && e.value?.rank === 1);
  if (latestGoogle) {
    const d = latestGoogle.match_details ?? {};
    if (!d.streetMatch || !d.numberMatch) {
      out.push({ title: 'Google-adres wijkt af van het register', detail: `Google: ${latestGoogle.value?.address ?? '?'} · ${d.explanation ?? ''}` });
    }
    const gs = latestGoogle.value?.business_status;
    if (gs && gs !== 'OPERATIONAL' && ent?.legal_status_norm === 'normal') {
      out.push({ title: 'Register actief, Google niet open', detail: `Register: normale toestand · Google: ${gs} (${latestGoogle.match_quality} match)` });
    }
    if (gs === 'OPERATIONAL' && ['bankruptcy', 'liquidation', 'dissolved'].includes(ent?.legal_status_norm)) {
      out.push({ title: 'Register inactief, Google open', detail: `Register: ${ent.legal_status} · Google: OPERATIONAL (${latestGoogle.match_quality} match). Mogelijk overname of nieuwe uitbater.` });
    }
  }
  for (const e of evidence.filter((e) => e.source === 'kbo_api' && e.evidence_type === 'legal_status' && e.value?.vkbo)) {
    out.push({ title: 'VKBO ≠ KBO API', detail: e.summary_nl });
  }
  if (ent?.completeness === 'number_only') {
    out.push({ title: 'Onderneming onbekend', detail: 'De moederonderneming is enkel als nummer bekend; juridische status nog niet gecontroleerd.' });
  }
  return out;
}

function ContactCard({ establishment, enterprise, evidence }: { establishment: any; enterprise: any; evidence: Evidence[] }) {
  const items: { value: string; kind: string; scope: string; source: string; date: string | null; url?: string | null }[] = [];
  if (establishment?.phone) items.push({ value: establishment.phone, kind: 'Telefoon', scope: 'Vestiging (lokaal)', source: 'VKBO', date: establishment.source_retrieved_at });
  if (establishment?.email) items.push({ value: establishment.email, kind: 'E-mail', scope: 'Vestiging (lokaal)', source: 'VKBO', date: establishment.source_retrieved_at });
  if (enterprise?.phone) items.push({ value: enterprise.phone, kind: 'Telefoon', scope: 'Onderneming (zetel)', source: enterprise.source === 'kbo_api' ? 'KBO API' : 'VKBO', date: enterprise.source_retrieved_at });
  if (enterprise?.email) items.push({ value: enterprise.email, kind: 'E-mail', scope: 'Onderneming (zetel)', source: enterprise.source === 'kbo_api' ? 'KBO API' : 'VKBO', date: enterprise.source_retrieved_at });
  for (const e of evidence.filter((e) => e.source === 'google_places' && ['phone', 'website'].includes(e.evidence_type))) {
    items.push({
      value: e.value?.phone ?? e.value?.website, kind: e.evidence_type === 'phone' ? 'Telefoon' : 'Website',
      scope: `Publieke vermelding (${e.match_quality ?? '?'} match)`, source: 'Google Places', date: e.retrieved_at, url: e.url,
    });
  }
  return (
    <Card title="Contact">
      {items.length === 0 ? (
        <p className="text-sm text-slate-600">Contactgegevens onbekend.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
              <span>
                <span className="text-slate-500">{c.kind}: </span>
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{c.value}</a> : c.value}
              </span>
              <span className="text-xs text-slate-500">{c.scope} · {c.source} · {formatDate(c.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
