import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeFunction, supabase } from '../lib/supabase';
import type { Analysis, Evidence, Reason, SubjectType } from '../lib/types';
import { ACTIVITY_LABEL, ACTIVITY_STYLE, CONFIDENCE_PLAIN, formatDate, formatNumber, REGISTER_PLAIN } from '../lib/labels';
import EvidenceList from './EvidenceList';

const KBO_PUBLIC = (n: string) => `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${n}`;

const VERDICT: Record<string, string> = {
  active: 'Deze zaak is zeer waarschijnlijk nog actief.',
  likely_active: 'Deze zaak is waarschijnlijk nog actief.',
  uncertain: 'We kunnen nog niet zeggen of deze zaak actief is.',
  likely_inactive: 'Deze zaak is waarschijnlijk gestopt.',
  inactive: 'Deze zaak is zeer waarschijnlijk gestopt.',
};

const REASON_ICON: Record<string, { icon: string; style: string }> = {
  supports_active: { icon: '✓', style: 'bg-emerald-100 text-emerald-700' },
  supports_inactive: { icon: '✕', style: 'bg-rose-100 text-rose-700' },
  conflict: { icon: '!', style: 'bg-amber-100 text-amber-800' },
  uncertainty: { icon: '?', style: 'bg-slate-100 text-slate-600' },
  info: { icon: 'i', style: 'bg-sky-100 text-sky-700' },
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '') return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function RecordDetail({ subjectType, number }: { subjectType: SubjectType; number: string }) {
  const [establishment, setEstablishment] = useState<any>(null);
  const [enterprise, setEnterprise] = useState<any>(null);
  const [otherLocations, setOtherLocations] = useState(0);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'check' | 'google' | 'confirm' | null>(null);
  const [method, setMethod] = useState('telefonisch contact');
  const [error, setError] = useState<string | null>(null);

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
      supabase.from('establishments').select('establishment_number', { count: 'exact', head: true }).eq('enterprise_number', entNr),
      subjectType === 'establishment'
        ? supabase.from('evidence').select('*').or(`establishment_number.eq.${number},and(enterprise_number.eq.${entNr},establishment_number.is.null)`).order('retrieved_at', { ascending: false })
        : supabase.from('evidence').select('*').eq('enterprise_number', number).is('establishment_number', null).order('retrieved_at', { ascending: false }),
      supabase.from('analysis').select('*').eq(subjectType === 'establishment' ? 'establishment_number' : 'enterprise_number', number)
        .eq('subject_type', subjectType).eq('is_current', true).maybeSingle(),
    ]);
    setEstablishment(est);
    setEnterprise(ent.data);
    setOtherLocations(Math.max(0, (sib.count ?? 0) - (est ? 1 : 0)));
    setEvidence((ev.data ?? []) as Evidence[]);
    setAnalysis(an.data as Analysis | null);
    setLoaded(true);
  }, [subjectType, number]);

  useEffect(() => { load(); }, [load]);

  const check = async (includeGoogle: boolean) => {
    setBusy(includeGoogle ? 'google' : 'check');
    setError(null);
    try {
      await invokeFunction('check-activity', { subject_type: subjectType, number, include_google: includeGoogle });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmActive = async (action: 'confirm' | 'revoke') => {
    setBusy('confirm');
    setError(null);
    try {
      await invokeFunction('confirm-active', { subject_type: subjectType, number, action, method });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Bij openen automatisch controleren met de gratis bronnen als er nog geen volledige score is.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!loaded || autoChecked.current) return;
    autoChecked.current = true;
    if (!analysis || analysis.activity_score == null) check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!enterprise) return <p className="text-slate-500">Laden…</p>;

  const name = subjectType === 'establishment'
    ? establishment?.commercial_name ?? establishment?.name ?? enterprise.commercial_name ?? enterprise.name
    : enterprise.commercial_name ?? enterprise.name;
  const officialName = establishment?.name ?? enterprise.name;
  const address = subjectType === 'establishment'
    ? `${[establishment?.kbo_street, establishment?.kbo_house_number].filter(Boolean).join(' ')}${establishment?.kbo_box ? ` bus ${establishment.kbo_box}` : ''}, ${establishment?.kbo_postcode ?? ''} ${establishment?.kbo_municipality ?? ''}`
    : `${[enterprise.seat_street, enterprise.seat_house_number].filter(Boolean).join(' ')}, ${enterprise.seat_postcode ?? ''} ${enterprise.seat_municipality ?? ''}`;
  const seatElsewhere = subjectType === 'establishment' && enterprise.completeness === 'full'
    && `${enterprise.seat_street} ${enterprise.seat_house_number} ${enterprise.seat_municipality}` !== `${establishment?.kbo_street} ${establishment?.kbo_house_number} ${establishment?.kbo_municipality}`;
  const started = establishment?.start_date ?? enterprise.start_date;

  const label = analysis?.activity_label ?? null;
  const style = label ? ACTIVITY_STYLE[label] : null;
  const conf = analysis ? CONFIDENCE_PLAIN[analysis.confidence] : null;
  const confirmation = analysis?.reasons?.find((r) => r.rule === 'O1_confirmed_active');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{name ?? 'Naam onbekend'}</h1>
          <p className="mt-1 text-slate-600">{address}</p>
          <p className="text-sm text-slate-500">Ondernemingsnummer {formatNumber(enterprise.enterprise_number)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => check(false)} disabled={!!busy} className="rounded-lg bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'check' ? 'Bezig met controleren…' : 'Opnieuw controleren'}
          </button>
          <button onClick={() => check(true)} disabled={!!busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {busy === 'google' ? 'Google wordt gecontroleerd…' : 'Ook Google controleren'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-rose-800">Er ging iets mis: {error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <section className={`rounded-xl p-6 shadow-sm ring-1 ring-slate-200 ${style?.bg ?? 'bg-white'}`}>
            {analysis?.activity_score != null && label && style && conf ? (
              <>
                <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Conclusie</p>
                <p className={`mt-1 text-2xl font-semibold ${style.text}`}>{ACTIVITY_LABEL[label]}</p>
                <p className="mt-1 text-slate-700">{VERDICT[label]}</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-3 flex-1 rounded-full bg-white/80 ring-1 ring-slate-200">
                    <div className={`h-3 rounded-full ${style.bar}`} style={{ width: `${analysis.activity_score}%` }} />
                  </div>
                  <span className="text-lg font-semibold tabular-nums">{analysis.activity_score}<span className="text-sm font-normal text-slate-500">/100</span></span>
                </div>
                <div className="mt-4 rounded-lg bg-white/70 p-3">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Hoe zeker is dit?</span>
                    <span className="inline-flex gap-0.5" aria-hidden>
                      {[1, 2, 3].map((i) => (
                        <span key={i} className={`h-2.5 w-2.5 rounded-full ${i <= conf.dots ? 'bg-slate-700' : 'bg-slate-300'}`} />
                      ))}
                    </span>
                    <span className="font-medium">{conf.short}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">{conf.long}</p>
                </div>
              </>
            ) : (
              <p className="text-slate-600">{busy ? 'Bezig met controleren…' : 'Nog niet gecontroleerd.'}</p>
            )}
          </section>

          {analysis?.activity_score != null && (
            confirmation ? (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                <p className="text-sm text-emerald-900"><span className="font-semibold">✓ </span>{confirmation.text_nl}</p>
                <button onClick={() => confirmActive('revoke')} disabled={!!busy} className="text-sm text-slate-600 underline hover:text-slate-900 disabled:opacity-50">
                  Bevestiging intrekken
                </button>
              </section>
            ) : (
              <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm font-medium">Heb je zelf nagegaan dat deze zaak nog actief is?</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" aria-label="Hoe nagegaan">
                    <option value="telefonisch contact">Telefonisch contact</option>
                    <option value="bezoek ter plaatse">Bezoek ter plaatse</option>
                    <option value="e-mail of brief">E-mail of brief</option>
                    <option value="andere">Andere</option>
                  </select>
                  <button onClick={() => confirmActive('confirm')} disabled={!!busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === 'confirm' ? 'Bezig…' : 'Deze zaak is actief'}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">De bevestiging blijft 12 maanden geldig.</p>
              </section>
            )
          )}

          {analysis?.reasons?.length ? (
            <Card title="Waarom?">
              <ul className="space-y-2.5">
                {orderReasons(analysis.reasons.filter((r) => r.rule !== 'O1_confirmed_active')).map((r, i) => {
                  const ic = REASON_ICON[r.effect] ?? REASON_ICON.info;
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ic.style}`}>{ic.icon}</span>
                      <span className="text-slate-800">{r.text_nl}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card title="Wat hebben we gecontroleerd?">
            <SourcesOverview enterprise={enterprise} evidence={evidence} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Gegevens">
            <dl>
              <Row label="Naam">{name}</Row>
              <Row label="Officiële naam">{officialName && officialName !== name ? officialName : null}</Row>
              <Row label="Adres">{address}</Row>
              <Row label="Ondernemingsnummer">
                <a className="text-sky-700 hover:underline" href={KBO_PUBLIC(enterprise.enterprise_number)} target="_blank" rel="noreferrer">
                  {formatNumber(enterprise.enterprise_number)} ↗
                </a>
              </Row>
              <Row label="Soort">
                {enterprise.entity_type === 'natural_person' ? 'Zelfstandige (eenmanszaak)' : enterprise.legal_form ?? (enterprise.entity_type === 'legal_person' ? 'Vennootschap of vereniging' : null)}
              </Row>
              <Row label="Register">{REGISTER_PLAIN[enterprise.legal_status_norm] ?? enterprise.legal_status}</Row>
              <Row label="Activiteit">{enterprise.nace_main_description ?? establishment?.nace_rsz_description}</Row>
              <Row label="Gestart">{started ? formatDate(started) : null}</Row>
              <Row label="Hoofdzetel">
                {seatElsewhere ? `${[enterprise.seat_street, enterprise.seat_house_number].filter(Boolean).join(' ')}, ${enterprise.seat_postcode ?? ''} ${enterprise.seat_municipality ?? ''}` : null}
              </Row>
              <Row label="Andere vestigingen">{otherLocations > 0 ? `${otherLocations} (volgens het register)` : null}</Row>
            </dl>
          </Card>

          <ContactCard establishment={establishment} enterprise={enterprise} evidence={evidence} />

          <details className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">Alle bewijsstukken bekijken ({evidence.length})</summary>
            <div className="mt-3">
              <EvidenceList evidence={evidence} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

/** Belangrijkste eerst: tegen, voor, let op, onzeker, info. */
function orderReasons(reasons: Reason[]): Reason[] {
  const rank: Record<string, number> = { supports_inactive: 0, supports_active: 1, conflict: 2, uncertainty: 3, info: 4 };
  return [...reasons].sort((a, b) => (rank[a.effect] ?? 9) - (rank[b.effect] ?? 9) || Math.abs(b.points ?? 0) - Math.abs(a.points ?? 0));
}

type SourceLine = { name: string; text: string; ok: boolean | null; at: string | null };

function SourcesOverview({ enterprise, evidence }: { enterprise: any; evidence: Evidence[] }) {
  const latestOf = (source: string) => {
    const rows = evidence.filter((e) => e.source === source);
    if (!rows.length) return { rows: [] as Evidence[], at: null as string | null };
    const at = rows.reduce((m, e) => (e.retrieved_at > m ? e.retrieved_at : m), rows[0].retrieved_at);
    return { rows: rows.filter((e) => e.retrieved_at === at), at };
  };
  const kbo = latestOf('kbo_api');
  const google = latestOf('google_places');
  const web = latestOf('website');
  const acc = latestOf('jaarrekening');

  const googleLine = ((): Omit<SourceLine, 'name' | 'at'> => {
    if (!google.at) return { text: 'Nog niet gecontroleerd', ok: null };
    const status = google.rows.find((e) => e.evidence_type === 'business_status' && e.match_quality !== 'uncertain');
    if (status) {
      const s = status.value?.business_status;
      if (s === 'OPERATIONAL') return { text: 'Zaak gevonden — open', ok: true };
      if (s === 'CLOSED_PERMANENTLY') return { text: 'Zaak gevonden — definitief gesloten', ok: false };
      return { text: 'Zaak gevonden — tijdelijk gesloten', ok: null };
    }
    const none = google.rows.find((e) => e.evidence_type === 'no_result');
    if (none?.value?.address_only) return { text: 'Geen zaak op dit adres, enkel het gebouw', ok: false };
    if (none) return { text: 'Deze zaak is niet gevonden', ok: false };
    return { text: 'Geen zaak gevonden die zeker overeenkomt', ok: null };
  })();

  const webLine = ((): Omit<SourceLine, 'name' | 'at'> => {
    const w = web.rows.find((e) => ['reachable', 'blocked'].includes(e.value?.outcome)) ?? web.rows[0];
    if (!w) return { text: 'Geen website bekend', ok: null };
    const o = w.value?.outcome;
    if (o === 'reachable' || o === 'blocked') return { text: 'Website werkt', ok: true };
    if (o === 'closed_signal') return { text: 'Website meldt sluiting of te koop', ok: false };
    if (o === 'domain_not_found') return { text: 'Website bestaat niet meer', ok: false };
    return { text: 'Website kon niet gecontroleerd worden', ok: null };
  })();

  const accLine = ((): Omit<SourceLine, 'name' | 'at'> => {
    if (enterprise.entity_type === 'natural_person') return { text: 'Niet van toepassing (zelfstandige)', ok: null };
    const a = acc.rows.find((e) => e.evidence_type === 'annual_account');
    if (a) {
      const y = a.value?.latest_year as number | null;
      return { text: y ? `Laatste jaarrekening: ${y}` : 'Geen jaarrekeningen gevonden', ok: y ? y >= new Date().getFullYear() - 2 : false };
    }
    if (acc.rows.some((e) => e.evidence_type === 'error')) return { text: 'Tijdelijk niet beschikbaar', ok: null };
    return { text: 'Nog niet gecontroleerd', ok: null };
  })();

  const legal = enterprise.legal_status_norm;
  const items: SourceLine[] = [
    { name: 'Ondernemingsregister', text: REGISTER_PLAIN[legal] ?? 'Onbekend', ok: legal === 'normal' ? true : ['bankruptcy', 'dissolved', 'liquidation'].includes(legal) ? false : null, at: kbo.at ?? enterprise.source_retrieved_at },
    { name: 'Google', ...googleLine, at: google.at },
    { name: 'Website', ...webLine, at: web.at },
    { name: 'Jaarrekening', ...accLine, at: acc.at },
  ];

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={it.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${it.ok === true ? 'bg-emerald-500' : it.ok === false ? 'bg-rose-500' : 'bg-slate-300'}`} />
            <span className="font-medium">{it.name}</span>
          </span>
          <span className="text-right text-slate-700">
            {it.text}
            {it.at && <span className="block text-xs text-slate-400">gecontroleerd op {formatDate(it.at)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ContactCard({ establishment, enterprise, evidence }: { establishment: any; enterprise: any; evidence: Evidence[] }) {
  const items: { kind: string; value: string; href?: string; where: string }[] = [];
  const seen = new Set<string>();
  const push = (kind: string, value: string | null | undefined, where: string, href?: string) => {
    if (!value) return;
    const key = `${kind}:${value.replace(/\W/g, '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ kind, value, where, href });
  };
  push('Telefoon', establishment?.phone, 'register (deze vestiging)', establishment?.phone ? `tel:${establishment.phone}` : undefined);
  push('E-mail', establishment?.email, 'register (deze vestiging)', establishment?.email ? `mailto:${establishment.email}` : undefined);
  for (const e of evidence.filter((x) => x.source === 'google_places' && x.match_quality !== 'uncertain')) {
    if (e.evidence_type === 'phone') push('Telefoon', e.value?.phone, 'Google', `tel:${e.value?.phone}`);
    if (e.evidence_type === 'website') push('Website', e.value?.website, 'Google', e.value?.website);
  }
  push('Telefoon', enterprise.phone, 'register (hoofdzetel)', enterprise.phone ? `tel:${enterprise.phone}` : undefined);
  push('E-mail', enterprise.email, 'register (hoofdzetel)', enterprise.email ? `mailto:${enterprise.email}` : undefined);

  return (
    <Card title="Contact">
      {items.length === 0 ? (
        <p className="text-sm text-slate-600">Contactgegevens onbekend.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="text-slate-500">{c.kind}: </span>
                {c.href ? <a href={c.href} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{c.value}</a> : c.value}
              </span>
              <span className="text-xs text-slate-400">bron: {c.where}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
