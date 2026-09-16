export type SubjectType = 'enterprise' | 'establishment';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type ProposedStatus =
  | 'active_likely' | 'temporarily_closed' | 'possibly_inactive'
  | 'conflict_manual_check' | 'address_issue' | 'insufficient_evidence';

export type StreetRecord = {
  subject_type: SubjectType;
  record_number: string;
  enterprise_number: string;
  establishment_number: string | null;
  municipality_id: string | null;
  display_name: string | null;
  official_name: string | null;
  street: string | null;
  house_number: string | null;
  box: string | null;
  geo_quality: string;
  address_mismatch: boolean;
  enterprise_legal_status: string;
  enterprise_completeness: 'full' | 'number_only';
  enterprise_seat_municipality: string | null;
  analysis_id: string | null;
  proposed_status: ProposedStatus | null;
  confidence: Confidence | null;
  last_decision: 'confirmed' | 'rejected' | null;
  last_reviewed_at: string | null;
};

export type Evidence = {
  id: string;
  enterprise_number: string | null;
  establishment_number: string | null;
  source: 'vkbo' | 'kbo_api' | 'google_places' | 'jaarrekening' | 'website' | 'officer';
  source_record_id: string | null;
  evidence_type: string;
  value: any;
  summary_nl: string;
  url: string | null;
  observed_at: string | null;
  retrieved_at: string;
  match_quality: 'exact' | 'probable' | 'uncertain' | null;
  match_details: any;
};

export type Reason = { rule: string; text_nl: string; effect: string; points?: number; family?: string; evidence_ids: string[] };

export type Analysis = {
  id: string;
  subject_type: SubjectType;
  proposed_status: ProposedStatus;
  confidence: Confidence;
  activity_score: number | null;
  activity_label: ActivityLabel | null;
  summary_nl: string;
  reasons: Reason[];
  evidence_ids: string[];
  model_version: string;
  is_current: boolean;
  created_at: string;
};

export type Review = {
  id: string;
  analysis_id: string;
  decision: 'confirmed' | 'rejected';
  final_status: ProposedStatus | null;
  comment: string | null;
  reviewer: string;
  reviewed_at: string;
};

export type ActivityLabel = 'active' | 'likely_active' | 'uncertain' | 'likely_inactive' | 'inactive';

export type SearchResult = {
  subject_type: SubjectType;
  number: string;
  enterprise_number: string;
  name: string | null;
  official_name: string | null;
  address: string;
  postcode: string | null;
  municipality: string | null;
  in_municipality: boolean;
  enterprise_name: string | null;
  enterprise_completeness: 'full' | 'number_only';
  legal_status_norm: string;
  seat_municipality: string | null;
  start_date: string | null;
  analysis: { activity_score: number | null; activity_label: ActivityLabel | null; confidence: Confidence; proposed_status: ProposedStatus; created_at: string } | null;
};

export type StepResult = { source: string; status: 'ok' | 'cached' | 'skipped' | 'limit' | 'error'; message: string };
