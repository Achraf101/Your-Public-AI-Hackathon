// Activiteitsmodel rules-v2 — uitlegbaar puntensysteem.
// Score 0–100 = hoe sterk het bewijs wijst op een ACTIEVE zaak (start 50 = geen informatie).
// Zekerheid (HIGH/MEDIUM/LOW) = hoeveel onafhankelijk, sterk en eensgezind bewijs er is.
// De score is (nog) geen gekalibreerde kans: kalibreren kan pas na validatie met gecontroleerde bedrijven.
import { LEGAL_STATUS_NL, type LegalStatusNorm } from './normalize.ts';

export const MODEL_VERSION = 'rules-v2';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type ActivityLabel = 'active' | 'likely_active' | 'uncertain' | 'likely_inactive' | 'inactive';
export type ProposedStatus =
  | 'active_likely' | 'temporarily_closed' | 'possibly_inactive'
  | 'conflict_manual_check' | 'address_issue' | 'insufficient_evidence';

export type EvidenceRow = {
  id: string; source: string; evidence_type: string; value: any; summary_nl: string;
  match_quality: 'exact' | 'probable' | 'uncertain' | null; retrieved_at: string; observed_at: string | null;
  establishment_number: string | null; enterprise_number: string | null;
};

export type AnalysisInput = {
  subject_type: 'enterprise' | 'establishment';
  legal_status_norm: LegalStatusNorm;
  enterprise_completeness: 'full' | 'number_only';
  enterprise_entity_type: string;
  enterprise_legal_form: string | null;
  enterprise_start_date: string | null;
  enterprise_ex_officio_strike_off: any | null;
  subject_start_date: string | null;
  subject_address_struck_off: any | null;
  address_mismatch: boolean;
  geo_quality: string;
  evidence: EvidenceRow[];
  today?: Date;
};

export type Reason = {
  rule: string; text_nl: string; points: number;
  effect: 'supports_active' | 'supports_inactive' | 'conflict' | 'uncertainty' | 'info';
  family: 'register' | 'google' | 'accounts' | 'website' | 'none';
  evidence_ids: string[];
};

export type AnalysisResult = {
  activity_score: number; activity_label: ActivityLabel; confidence: Confidence;
  proposed_status: ProposedStatus; summary_nl: string; reasons: Reason[]; evidence_ids: string[];
};

export const LABEL_NL: Record<ActivityLabel, string> = {
  active: 'Actief', likely_active: 'Waarschijnlijk actief', uncertain: 'Onzeker', likely_inactive: 'Waarschijnlijk inactief', inactive: 'Inactief',
};

const latest = (rows: EvidenceRow[]) => [...rows].sort((a, b) => b.retrieved_at.localeCompare(a.retrieved_at))[0];
const yearsAgo = (date: string | null | undefined, today: Date) => (date ? (today.getTime() - new Date(date).getTime()) / (365.25 * 86400000) : null);

export function analyze(input: AnalysisInput): AnalysisResult {
  const today = input.today ?? new Date();
  const ev = input.evidence;
  const reasons: Reason[] = [];
  const add = (rule: string, points: number, text_nl: string, family: Reason['family'], rows: (EvidenceRow | undefined)[] = [], effect?: Reason['effect']) =>
    reasons.push({
      rule, points, text_nl, family, evidence_ids: rows.filter(Boolean).map((r) => r!.id),
      effect: effect ?? (points > 0 ? 'supports_active' : points < 0 ? 'supports_inactive' : 'info'),
    });

  // ---------------- Register (VKBO / KBO API) ----------------
  const legalEv = latest(ev.filter((e) => e.evidence_type === 'legal_status' && !e.establishment_number && !e.value?.conflict));
  const legal = input.legal_status_norm;
  if (input.enterprise_completeness === 'number_only') {
    add('R0_parent_unknown', 0, 'Onderneming enkel als nummer bekend: juridische status nog niet opgehaald.', 'none', [], 'uncertainty');
  } else if (legal === 'bankruptcy') add('R1_bankruptcy', -40, 'Register: onderneming in faillissement.', 'register', [legalEv]);
  else if (legal === 'dissolved') add('R1_dissolved', -40, 'Register: onderneming ontbonden.', 'register', [legalEv]);
  else if (legal === 'liquidation') add('R1_liquidation', -35, 'Register: onderneming in vereffening.', 'register', [legalEv]);
  else if (legal === 'reorganisation') add('R1_reorganisation', -10, 'Register: gerechtelijke reorganisatie.', 'register', [legalEv]);
  else if (legal === 'normal') add('R1_normal', 5, 'Register: normale toestand (zegt weinig: het register loopt achter).', 'register', [legalEv]);

  const kboStatus = latest(ev.filter((e) => e.source === 'kbo_api' && e.evidence_type === 'legal_status' && e.value?.status));
  if (kboStatus && kboStatus.value.status !== 'active') add('R2_kbo_stopped', -40, `KBO API: status "${kboStatus.value.status}".`, 'register', [kboStatus]);
  const legalConflict = ev.find((e) => e.evidence_type === 'legal_status' && e.value?.conflict);
  if (legalConflict) add('R2_source_conflict', 0, legalConflict.summary_nl, 'register', [legalConflict], 'conflict');

  if (input.enterprise_ex_officio_strike_off) {
    const reason = String(input.enterprise_ex_officio_strike_off.reason ?? '');
    add('R3_ex_officio', reason.includes('jaarrekening') ? -25 : -15, `Register: ambtshalve doorhaling (${reason || 'reden onbekend'}).`, 'register', ev.filter((e) => e.evidence_type === 'strike_off' && !e.establishment_number));
  }
  const estStrike = ev.filter((e) => e.evidence_type === 'strike_off' && e.establishment_number);
  if (input.subject_address_struck_off || estStrike.length) add('R4_struck', -25, 'Register: adres of vestiging doorgehaald.', 'register', estStrike);

  const startAge = yearsAgo(input.subject_start_date ?? input.enterprise_start_date, today);
  if (startAge != null && startAge < 2) add('R5_recent_start', 5, `Recent gestart (${(input.subject_start_date ?? input.enterprise_start_date)!.slice(0, 10)}).`, 'register');
  if (input.address_mismatch) add('R6_address_mismatch', 0, 'KBO-adres wijkt af van het adressenregister.', 'none', ev.filter((e) => e.source === 'vkbo' && e.evidence_type === 'address'), 'uncertainty');
  if (input.geo_quality !== 'ok') add('R7_geo', 0, `Coördinaat niet bruikbaar (${input.geo_quality}).`, 'none', [], 'uncertainty');
  if ((input.enterprise_legal_form ?? '').toLowerCase().includes('mede-eigenaars')) add('R8_vme', 0, 'Vereniging van mede-eigenaars: meestal geen handelszaak.', 'none');

  // ---------------- Google Places ----------------
  const gStatusEv = latest(ev.filter((e) => e.source === 'google_places' && e.evidence_type === 'business_status'));
  const gNoResult = latest(ev.filter((e) => e.source === 'google_places' && e.evidence_type === 'no_result'));
  const strong = gStatusEv && gStatusEv.match_quality !== 'uncertain' ? gStatusEv : undefined;
  const gStatus: string | null = strong?.value?.business_status ?? null;
  if (gStatusEv && !strong) add('G0_uncertain', 0, `Google-resultaat gevonden, maar match onzeker (${gStatusEv.value?.business_status ?? '?'}): niet meegeteld.`, 'none', [gStatusEv], 'uncertainty');
  else if (!gStatusEv && gNoResult) add('G0_no_result', -5, 'Google Places: geen vermelding gevonden.', 'google', [gNoResult]);
  else if (!gStatusEv) add('G0_not_checked', 0, 'Google Places nog niet gecontroleerd.', 'none', [], 'uncertainty');
  if (strong) {
    const exact = strong.match_quality === 'exact';
    const q = exact ? 'exacte match' : 'waarschijnlijke match';
    if (gStatus === 'OPERATIONAL') add('G1_operational', exact ? 30 : 20, `Google Places: open — ${q}.`, 'google', [strong]);
    if (gStatus === 'CLOSED_TEMPORARILY') add('G1_temp_closed', -10, `Google Places: tijdelijk gesloten — ${q}.`, 'google', [strong]);
    if (gStatus === 'CLOSED_PERMANENTLY') add('G1_closed', exact ? -45 : -35, `Google Places: definitief gesloten — ${q}.`, 'google', [strong]);
    const sameRun = ev.filter((e) => e.source === 'google_places' && e.retrieved_at === strong.retrieved_at);
    const hours = sameRun.find((e) => e.evidence_type === 'opening_hours');
    if (hours && gStatus === 'OPERATIONAL') add('G2_hours', 5, 'Google Places: openingsuren vermeld.', 'google', [hours]);
    const ratings = Number(strong.value?.user_rating_count ?? 0);
    if (ratings >= 10 && gStatus === 'OPERATIONAL') add('G3_reviews', 3, `Google Places: ${ratings} beoordelingen (publiek bekend).`, 'google', [strong]);
  }

  // ---------------- Jaarrekening.be ----------------
  const acc = latest(ev.filter((e) => e.source === 'jaarrekening' && e.evidence_type === 'annual_account'));
  const accError = latest(ev.filter((e) => e.source === 'jaarrekening' && e.evidence_type === 'error'));
  const currentYear = today.getFullYear();
  if (acc) {
    const y = acc.value?.latest_year as number | null;
    if (acc.value?.end_date) add('A0_end_date', -40, `Jaarrekening.be: einddatum onderneming ${String(acc.value.end_date).slice(0, 10)}.`, 'accounts', [acc]);
    if (y && y >= currentYear - 2) add('A1_recent_accounts', 15, `Recente jaarrekening (boekjaar ${y}).`, 'accounts', [acc]);
    else if (y && y === currentYear - 3) add('A1_older_accounts', 0, `Laatste jaarrekening boekjaar ${y}: niet recent.`, 'accounts', [acc], 'uncertainty');
    else if (y) add('A1_old_accounts', -20, `Laatste jaarrekening al van boekjaar ${y}.`, 'accounts', [acc]);
    else if (input.enterprise_entity_type === 'legal_person') add('A1_no_accounts', -10, 'Geen jaarrekeningen gevonden voor deze rechtspersoon.', 'accounts', [acc]);
    if (Number(acc.value?.employees) > 0) add('A2_employees', 5, `Werknemers volgens laatste jaarrekening: ${acc.value.employees} VTE.`, 'accounts', [acc]);
    // Jaarrekening zegt iets over de onderneming, niet over deze fysieke vestiging.
    if (input.subject_type === 'establishment') add('A3_scope', 0, 'Let op: jaarrekening gaat over de onderneming, niet specifiek over deze vestiging.', 'none', [], 'info');
  } else if (accError) {
    add('A0_unavailable', 0, accError.summary_nl, 'none', [accError], 'uncertainty');
  }
  const pub = latest(ev.filter((e) => e.source === 'jaarrekening' && e.evidence_type === 'publication'));
  if (pub?.observed_at) {
    const title = String(pub.value?.latest?.title ?? '').toLowerCase();
    const age = yearsAgo(pub.observed_at, today)!;
    if (/ontbinding|faillissement|vereffening|sluiting/.test(title) && age < 3) add('P1_closing_publication', -20, `Staatsblad (${pub.observed_at}): ${pub.value.latest.title}.`, 'accounts', [pub]);
    else if (age < 2) add('P1_recent_publication', 5, `Recente publicatie in het Staatsblad (${pub.observed_at}).`, 'accounts', [pub]);
  }

  // ---------------- Website ----------------
  const web = ev.filter((e) => e.source === 'website' && e.evidence_type === 'website_check');
  const latestRun = web.length ? latest(web)!.retrieved_at : null;
  const runChecks = web.filter((e) => e.retrieved_at === latestRun);
  const reachable = runChecks.find((e) => e.value?.outcome === 'reachable' || e.value?.outcome === 'blocked');
  const closedSig = runChecks.find((e) => e.value?.outcome === 'closed_signal');
  const deadDomain = runChecks.find((e) => e.value?.outcome === 'domain_not_found');
  if (closedSig) add('W1_closed_signal', -10, closedSig.summary_nl, 'website', [closedSig]);
  else if (reachable) add('W1_reachable', reachable.value?.mentions_local ? 8 : 4, reachable.summary_nl, 'website', [reachable]);
  else if (deadDomain) add('W1_dead_domain', -8, deadDomain.summary_nl, 'website', [deadDomain]);

  // ---------------- Score, label, zekerheid, voorstel ----------------
  const total = reasons.reduce((s, r) => s + r.points, 0);
  const score = Math.max(0, Math.min(100, 50 + total));
  const label: ActivityLabel = score >= 80 ? 'active' : score >= 60 ? 'likely_active' : score > 40 ? 'uncertain' : score > 20 ? 'likely_inactive' : 'inactive';

  const legalInactive = ['bankruptcy', 'liquidation', 'dissolved'].includes(legal);
  const conflict = (legalInactive && gStatus === 'OPERATIONAL') || (!legalInactive && legal === 'normal' && gStatus === 'CLOSED_PERMANENTLY') || !!legalConflict;
  if (conflict) add('C1_conflict', 0, 'Bronnen spreken elkaar tegen — manuele controle nodig.', 'none', [], 'conflict');

  // Sterke externe bronnen (buiten het register) die een richting aangeven.
  const strongFamilies = new Map<string, number>();
  for (const r of reasons) {
    if (r.family === 'none' || Math.abs(r.points) < 8) continue;
    strongFamilies.set(r.family, (strongFamilies.get(r.family) ?? 0) + r.points);
  }
  const external = [...strongFamilies].filter(([f]) => f !== 'register');
  const directions = new Set([...strongFamilies.values()].map((p) => Math.sign(p)));
  let confidence: Confidence;
  if (conflict || input.enterprise_completeness === 'number_only') confidence = 'LOW';
  else if (external.length >= 2 && directions.size === 1) confidence = 'HIGH';
  else if (external.length >= 1 && directions.size === 1 && (strongFamilies.has('register') || Math.abs(external[0][1]) >= 25)) confidence = score >= 80 || score <= 20 ? 'HIGH' : 'MEDIUM';
  else if (external.length >= 1 || strongFamilies.has('register')) confidence = 'MEDIUM';
  else confidence = 'LOW';

  let proposed: ProposedStatus;
  if (conflict) proposed = 'conflict_manual_check';
  else if (gStatus === 'CLOSED_TEMPORARILY') proposed = 'temporarily_closed';
  else if (label === 'active' || label === 'likely_active') proposed = 'active_likely';
  else if (label === 'inactive' || label === 'likely_inactive') proposed = 'possibly_inactive';
  else if (input.subject_address_struck_off || estStrike.length) proposed = 'address_issue';
  else proposed = 'insufficient_evidence';

  const top = [...reasons].filter((r) => Math.abs(r.points) >= 8).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 2).map((r) => r.text_nl.replace(/\.$/, ''));
  const summary = conflict
    ? `Conflict tussen bronnen (score ${score}/100). ${legalInactive ? `Register: ${LEGAL_STATUS_NL[legal]}` : 'Register zonder stopzetting'}, maar Google ${gStatus === 'OPERATIONAL' ? 'toont open' : 'meldt gesloten'}. Controleer manueel.`
    : `${LABEL_NL[label]} (score ${score}/100, zekerheid ${({ HIGH: 'hoog', MEDIUM: 'middel', LOW: 'laag' } as const)[confidence]})${top.length ? ` — vooral: ${top.join('; ')}` : ' — nog geen doorslaggevend bewijs'}.`;

  return {
    activity_score: score, activity_label: label, confidence, proposed_status: proposed, summary_nl: summary,
    reasons, evidence_ids: [...new Set(reasons.flatMap((r) => r.evidence_ids))],
  };
}
