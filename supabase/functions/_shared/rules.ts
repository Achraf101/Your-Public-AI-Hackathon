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
  match_quality: 'exact' | 'probable' | 'uncertain' | null; match_details?: any; retrieved_at: string; observed_at: string | null;
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
    add('R0_parent_unknown', 0, 'We kennen de onderneming achter deze zaak nog niet (klik op Opnieuw controleren).', 'none', [], 'uncertainty');
  } else if (legal === 'bankruptcy') add('R1_bankruptcy', -40, 'De onderneming is failliet verklaard.', 'register', [legalEv]);
  else if (legal === 'dissolved') add('R1_dissolved', -40, 'De onderneming is ontbonden.', 'register', [legalEv]);
  else if (legal === 'liquidation') add('R1_liquidation', -35, 'De onderneming wordt stopgezet (vereffening).', 'register', [legalEv]);
  else if (legal === 'reorganisation') add('R1_reorganisation', -10, 'De onderneming zit in een gerechtelijke reorganisatie.', 'register', [legalEv]);
  else if (legal === 'normal') add('R1_normal', 5, 'Volgens het register is de onderneming in orde (dat zegt weinig: het register loopt vaak achter).', 'register', [legalEv]);

  const kboStatus = latest(ev.filter((e) => e.source === 'kbo_api' && e.evidence_type === 'legal_status' && e.value?.status));
  if (kboStatus && kboStatus.value.status !== 'active') add('R2_kbo_stopped', -40, 'Volgens de KBO is de onderneming niet meer actief.', 'register', [kboStatus]);
  const legalConflict = ev.find((e) => e.evidence_type === 'legal_status' && e.value?.conflict);
  if (legalConflict) add('R2_source_conflict', 0, legalConflict.summary_nl, 'register', [legalConflict], 'conflict');

  if (input.enterprise_ex_officio_strike_off) {
    const reason = String(input.enterprise_ex_officio_strike_off.reason ?? '');
    add('R3_ex_officio', reason.includes('jaarrekening') ? -25 : -15, `De onderneming werd door de overheid geschrapt${reason ? ` (${reason.toLowerCase()})` : ''}.`, 'register', ev.filter((e) => e.evidence_type === 'strike_off' && !e.establishment_number));
  }
  const estStrike = ev.filter((e) => e.evidence_type === 'strike_off' && e.establishment_number);
  if (input.subject_address_struck_off || estStrike.length) add('R4_struck', -25, 'Het adres of de vestiging werd geschrapt in het register.', 'register', estStrike);

  const startAge = yearsAgo(input.subject_start_date ?? input.enterprise_start_date, today);
  if (startAge != null && startAge < 2) add('R5_recent_start', 5, `Recent gestart (${(input.subject_start_date ?? input.enterprise_start_date)!.slice(0, 4)}).`, 'register');
  if (input.address_mismatch) add('R6_address_mismatch', 0, 'Het adres in het register is niet helemaal volledig of correct.', 'none', ev.filter((e) => e.source === 'vkbo' && e.evidence_type === 'address'), 'uncertainty');
  if (input.geo_quality !== 'ok') add('R7_geo', 0, 'De ligging op de kaart is onbekend.', 'none', [], 'uncertainty');
  if ((input.enterprise_legal_form ?? '').toLowerCase().includes('mede-eigenaars')) add('R8_vme', 0, 'Dit is een vereniging van mede-eigenaars, geen handelszaak.', 'none');

  // ---------------- Google Places ----------------
  // Enkel de laatste Google-controle telt.
  const googleRows = ev.filter((e) => e.source === 'google_places');
  const lastRun = googleRows.length ? latest(googleRows)!.retrieved_at : null;
  const run = googleRows.filter((e) => e.retrieved_at === lastRun);
  const gStatusEv = run.find((e) => e.evidence_type === 'business_status');
  const strong = gStatusEv && gStatusEv.match_quality !== 'uncertain' ? gStatusEv : undefined;
  const gStatus: string | null = strong?.value?.business_status ?? null;
  const gNoResult = run.find((e) => e.evidence_type === 'no_result');
  const candidates = run.filter((e) => e.evidence_type === 'place_match');
  const googleChecked = !!lastRun;
  if (!googleChecked) {
    add('G0_not_checked', 0, 'Google is nog niet gecontroleerd.', 'none', [], 'uncertainty');
  } else if (!strong && gNoResult?.value?.address_only) {
    add('G0_no_business', -5, 'Google kent geen zaak op dit adres, enkel het gebouw.', 'google', [gNoResult]);
  } else if (!strong && gNoResult) {
    add('G0_no_result', -5, 'Google kent deze zaak niet.', 'google', [gNoResult]);
  } else if (!strong) {
    // Kandidaten gevonden, maar geen enkele komt zeker overeen (naam/adres/telefoon/website): niet meegeteld.
    add('G0_no_sure_match', 0, 'Google vond geen zaak die zeker overeenkomt met deze naam en dit adres.', 'none', candidates, 'uncertainty');
  }
  if (strong) {
    const d = strong.match_details ?? {};
    const how = d.phoneMatch ? 'herkend aan het telefoonnummer' : d.domainMatch ? 'herkend aan de website' : 'zelfde naam en adres';
    const elsewhere = !(d.streetMatch && d.numberMatch);
    if (gStatus === 'OPERATIONAL') add('G1_operational', strong.match_quality === 'exact' ? 30 : 20, `Google toont de zaak als open (${how}).`, 'google', [strong]);
    if (gStatus === 'CLOSED_TEMPORARILY') add('G1_temp_closed', -10, `Google meldt de zaak tijdelijk gesloten (${how}).`, 'google', [strong]);
    if (gStatus === 'CLOSED_PERMANENTLY') add('G1_closed', strong.match_quality === 'exact' ? -45 : -35, `Google meldt de zaak definitief gesloten (${how}).`, 'google', [strong]);
    const hours = run.find((e) => e.evidence_type === 'opening_hours');
    if (hours && gStatus === 'OPERATIONAL') add('G2_hours', 5, 'Google vermeldt openingsuren.', 'google', [hours]);
    const ratings = Number(strong.value?.user_rating_count ?? 0);
    if (ratings >= 10 && gStatus === 'OPERATIONAL') add('G3_reviews', 3, `Klanten gaven ${ratings} beoordelingen op Google.`, 'google', [strong]);
    const addr = run.find((e) => e.evidence_type === 'address');
    if (elsewhere && addr) add('G4_other_address', 0, `Let op: Google vermeldt een ander adres (${addr.value?.address}). Mogelijk klopt het adres in het register niet.`, 'none', [addr], 'conflict');
  }

  // ---------------- Jaarrekening.be ----------------
  const acc = latest(ev.filter((e) => e.source === 'jaarrekening' && e.evidence_type === 'annual_account'));
  const accError = latest(ev.filter((e) => e.source === 'jaarrekening' && e.evidence_type === 'error'));
  const currentYear = today.getFullYear();
  if (acc) {
    const y = acc.value?.latest_year as number | null;
    if (acc.value?.end_date) add('A0_end_date', -40, `De onderneming is stopgezet op ${String(acc.value.end_date).slice(0, 10)}.`, 'accounts', [acc]);
    if (y && y >= currentYear - 2) add('A1_recent_accounts', 15, `Er is een recente jaarrekening (${y}).`, 'accounts', [acc]);
    else if (y && y === currentYear - 3) add('A1_older_accounts', 0, `De laatste jaarrekening is van ${y}.`, 'accounts', [acc], 'uncertainty');
    else if (y) add('A1_old_accounts', -20, `De laatste jaarrekening is al van ${y}.`, 'accounts', [acc]);
    else if (input.enterprise_entity_type === 'legal_person') add('A1_no_accounts', -10, 'Er zijn geen jaarrekeningen neergelegd.', 'accounts', [acc]);
    if (Number(acc.value?.employees) > 0) add('A2_employees', 5, `De onderneming heeft werknemers (${acc.value.employees}).`, 'accounts', [acc]);
    // Jaarrekening zegt iets over de onderneming, niet over deze fysieke vestiging.
    if (input.subject_type === 'establishment') add('A3_scope', 0, 'De jaarrekening gaat over de hele onderneming, niet enkel over deze plaats.', 'none', [], 'info');
  } else if (accError) {
    add('A0_unavailable', 0, 'De jaarrekening kon niet opgehaald worden.', 'none', [accError], 'uncertainty');
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
  if (closedSig) add('W1_closed_signal', -10, 'De website meldt dat de zaak gesloten is of te koop staat.', 'website', [closedSig]);
  else if (reachable) add('W1_reachable', reachable.value?.mentions_local ? 8 : 4, reachable.value?.mentions_local ? 'De website werkt en vermeldt de gemeente.' : 'De website werkt.', 'website', [reachable]);
  else if (deadDomain) add('W1_dead_domain', -8, 'De website bestaat niet meer.', 'website', [deadDomain]);

  // Eenmanszaak zonder enige publieke vermelding: vaak activiteit aan huis of in bijberoep.
  if (input.enterprise_entity_type === 'natural_person' && googleChecked && !strong && !reachable) {
    add('H1_home_based', 0, 'Zelfstandige zonder publieke vermelding: mogelijk werkt die aan huis of in bijberoep. Een telefoontje of bezoek geeft zekerheid.', 'none', [], 'uncertainty');
  }

  // ---------------- Bevestiging door de gemeente ----------------
  const officerRows = ev.filter((e) => e.source === 'officer' && e.evidence_type === 'business_status');
  const lastOfficer = officerRows.length ? latest(officerRows) : undefined;
  let officerConfirmed = false;
  if (lastOfficer?.value?.action === 'confirm_active') {
    const when = lastOfficer.retrieved_at.slice(0, 10);
    const how = lastOfficer.value?.method ? ` (${lastOfficer.value.method})` : '';
    const age = yearsAgo(lastOfficer.retrieved_at, today)!;
    if (age <= 1) {
      officerConfirmed = true;
      add('O1_confirmed_active', 40, `Bevestigd als actief door de gemeente op ${when.split('-').reverse().join('/')}${how}.`, 'none', [lastOfficer], 'supports_active');
    } else {
      add('O1_confirmation_expired', 0, `De bevestiging door de gemeente is ouder dan een jaar (${when}): best opnieuw nagaan.`, 'none', [lastOfficer], 'uncertainty');
    }
  }

  // ---------------- Score, label, zekerheid, voorstel ----------------
  const total = reasons.reduce((s, r) => s + r.points, 0);
  const score = officerConfirmed ? Math.max(90, Math.min(100, 50 + total)) : Math.max(0, Math.min(100, 50 + total));
  const label: ActivityLabel = officerConfirmed ? 'active' : score >= 80 ? 'active' : score >= 60 ? 'likely_active' : score > 40 ? 'uncertain' : score > 20 ? 'likely_inactive' : 'inactive';

  const legalInactive = ['bankruptcy', 'liquidation', 'dissolved'].includes(legal);
  const conflict = (legalInactive && gStatus === 'OPERATIONAL') || (!legalInactive && legal === 'normal' && gStatus === 'CLOSED_PERMANENTLY') || !!legalConflict;
  if (officerConfirmed && legalInactive) add('C2_confirmed_but_register', 0, 'Let op: het register meldt nog steeds een stopzetting of faillissement. Mogelijk werkt er een nieuwe uitbater onder een ander ondernemingsnummer.', 'none', [], 'conflict');
  if (conflict && !officerConfirmed) add('C1_conflict', 0, 'De bronnen spreken elkaar tegen: best even nakijken.', 'none', [], 'conflict');

  // Sterke externe bronnen (buiten het register) die een richting aangeven.
  const strongFamilies = new Map<string, number>();
  for (const r of reasons) {
    if (r.family === 'none' || Math.abs(r.points) < 8) continue;
    strongFamilies.set(r.family, (strongFamilies.get(r.family) ?? 0) + r.points);
  }
  const external = [...strongFamilies].filter(([f]) => f !== 'register');
  const directions = new Set([...strongFamilies.values()].map((p) => Math.sign(p)));
  let confidence: Confidence;
  if (officerConfirmed) confidence = 'HIGH';
  else if (conflict || input.enterprise_completeness === 'number_only') confidence = 'LOW';
  else if (external.length >= 2 && directions.size === 1) confidence = 'HIGH';
  else if (external.length >= 1 && directions.size === 1 && (strongFamilies.has('register') || Math.abs(external[0][1]) >= 25)) confidence = score >= 80 || score <= 20 ? 'HIGH' : 'MEDIUM';
  else if (external.length >= 1 || strongFamilies.has('register')) confidence = 'MEDIUM';
  else confidence = 'LOW';

  let proposed: ProposedStatus;
  if (officerConfirmed) proposed = 'active_likely';
  else if (conflict) proposed = 'conflict_manual_check';
  else if (gStatus === 'CLOSED_TEMPORARILY') proposed = 'temporarily_closed';
  else if (label === 'active' || label === 'likely_active') proposed = 'active_likely';
  else if (label === 'inactive' || label === 'likely_inactive') proposed = 'possibly_inactive';
  else if (input.subject_address_struck_off || estStrike.length) proposed = 'address_issue';
  else proposed = 'insufficient_evidence';

  const top = [...reasons].filter((r) => Math.abs(r.points) >= 8).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 2).map((r) => r.text_nl.replace(/\.$/, ''));
  const summary = officerConfirmed
    ? `Actief — bevestigd door de gemeente.`
    : conflict
    ? `Conflict tussen bronnen (score ${score}/100). ${legalInactive ? `Register: ${LEGAL_STATUS_NL[legal]}` : 'Register zonder stopzetting'}, maar Google ${gStatus === 'OPERATIONAL' ? 'toont open' : 'meldt gesloten'}. Controleer manueel.`
    : `${LABEL_NL[label]} (score ${score}/100, zekerheid ${({ HIGH: 'hoog', MEDIUM: 'middel', LOW: 'laag' } as const)[confidence]})${top.length ? ` — vooral: ${top.join('; ')}` : ' — nog geen doorslaggevend bewijs'}.`;

  return {
    activity_score: score, activity_label: label, confidence, proposed_status: proposed, summary_nl: summary,
    reasons, evidence_ids: [...new Set(reasons.flatMap((r) => r.evidence_ids))],
  };
}
