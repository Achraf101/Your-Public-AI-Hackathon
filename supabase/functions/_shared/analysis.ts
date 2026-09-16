// Laadt onderwerp + evidence, voert rules-v2 uit en bewaart een nieuw voorstel (vorig blijft bewaard).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { analyze, MODEL_VERSION, type EvidenceRow } from './rules.ts';

export type Subject = { subject_type: 'enterprise' | 'establishment'; number: string };

export async function loadSubject(db: SupabaseClient, s: Subject) {
  if (s.subject_type === 'establishment') {
    const { data, error } = await db.from('establishments').select('*').eq('establishment_number', s.number).single();
    if (error) throw new Error(`Vestiging ${s.number} niet gevonden`);
    const { data: ent, error: e2 } = await db.from('enterprises').select('*').eq('enterprise_number', data.enterprise_number).single();
    if (e2) throw e2;
    return { subject: data, enterprise: ent };
  }
  const { data, error } = await db.from('enterprises').select('*').eq('enterprise_number', s.number).single();
  if (error) throw new Error(`Onderneming ${s.number} niet gevonden`);
  return { subject: data, enterprise: data };
}

export async function runAnalysis(db: SupabaseClient, s: Subject) {
  const { subject, enterprise } = await loadSubject(db, s);
  const entNr = enterprise.enterprise_number;
  const { data: evidence, error } = s.subject_type === 'establishment'
    ? await db.from('evidence').select('*').or(`establishment_number.eq.${s.number},and(enterprise_number.eq.${entNr},establishment_number.is.null)`)
    : await db.from('evidence').select('*').eq('enterprise_number', s.number).is('establishment_number', null);
  if (error) throw error;

  const result = analyze({
    subject_type: s.subject_type,
    legal_status_norm: enterprise.legal_status_norm,
    enterprise_completeness: enterprise.completeness,
    enterprise_entity_type: enterprise.entity_type,
    enterprise_legal_form: enterprise.legal_form,
    enterprise_start_date: enterprise.start_date,
    enterprise_ex_officio_strike_off: enterprise.ex_officio_strike_off,
    subject_start_date: s.subject_type === 'establishment' ? subject.start_date : null,
    subject_address_struck_off: subject.address_struck_off ?? null,
    address_mismatch: s.subject_type === 'establishment' ? subject.address_mismatch : false,
    geo_quality: s.subject_type === 'establishment' ? subject.geo_quality : subject.seat_geo_quality,
    evidence: (evidence ?? []) as EvidenceRow[],
  });

  const col = s.subject_type === 'establishment' ? 'establishment_number' : 'enterprise_number';
  const { error: updErr } = await db.from('analysis').update({ is_current: false }).eq(col, s.number).eq('subject_type', s.subject_type).eq('is_current', true);
  if (updErr) throw updErr;
  const { data: inserted, error: insErr } = await db.from('analysis').insert({
    subject_type: s.subject_type,
    enterprise_number: entNr,
    establishment_number: s.subject_type === 'establishment' ? s.number : null,
    ...result,
    model_version: MODEL_VERSION,
    is_current: true,
  }).select().single();
  if (insErr) throw insErr;
  return inserted;
}
