-- PROV-AI Challenge 1 — Find the Real Businesses
-- Datamodel: gemeenten, ondernemingen (juridische entiteit), vestigingen (fysieke plaats),
-- evidence (één observatie uit één bron), analysis (voorstel van het regelmodel) en
-- officer_reviews (beslissing van de medewerker, enkel toevoegen).
-- Ondernemings- en vestigingsnummers zijn altijd tekst van 10 cijfers (leading zeros!).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- municipalities
-- ---------------------------------------------------------------------------
create table public.municipalities (
  id          uuid primary key default gen_random_uuid(),
  nis_code    text not null unique check (nis_code ~ '^\d{5}$'),
  name        text not null,
  postcodes   text[] not null default '{}',
  province    text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- enterprises — juridische entiteit (rechtspersoon of natuurlijk persoon)
-- ---------------------------------------------------------------------------
create table public.enterprises (
  enterprise_number     text primary key check (enterprise_number ~ '^\d{10}$'),
  name                  text,
  commercial_name       text,
  abbreviation          text,
  entity_type           text not null default 'unknown'
                          check (entity_type in ('legal_person', 'natural_person', 'unknown')),
  legal_form            text,
  legal_status          text,            -- originele waarde uit de bron
  legal_status_norm     text not null default 'unknown'
                          check (legal_status_norm in ('normal', 'liquidation', 'bankruptcy', 'dissolved', 'reorganisation', 'other', 'unknown')),
  start_date            date,
  seat_street           text,
  seat_house_number     text,
  seat_box              text,
  seat_postcode         text,
  seat_municipality     text,
  seat_municipality_id  uuid references public.municipalities(id),  -- null = zetel buiten ingeladen gemeenten
  seat_lat              double precision,
  seat_lon              double precision,
  seat_geo_quality      text not null default 'missing'
                          check (seat_geo_quality in ('ok', 'placeholder', 'missing', 'outside_municipality')),
  ex_officio_strike_off jsonb,           -- {reason, start_date} ambtshalve doorhaling
  address_struck_off    jsonb,           -- {reason, date} adresdoorhaling
  phone                 text,
  email                 text,
  nace_main             text,
  nace_main_description text,
  completeness          text not null default 'full'
                          check (completeness in ('full', 'number_only')),
  source                text not null,   -- vkbo | kbo_api | stub
  source_retrieved_at   timestamptz,
  raw                   jsonb,           -- onveranderde bronrij
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- establishments — vestigingseenheid (fysieke plaats)
-- ---------------------------------------------------------------------------
create table public.establishments (
  establishment_number  text primary key check (establishment_number ~ '^\d{10}$'),
  enterprise_number     text not null references public.enterprises(enterprise_number),
  municipality_id       uuid references public.municipalities(id),
  name                  text,
  commercial_name       text,
  start_date            date,
  kbo_street            text,
  kbo_house_number      text,
  kbo_box               text,
  kbo_postcode          text,
  kbo_municipality      text,
  ar_street             text,
  ar_house_number       text,
  ar_box                text,
  ar_postcode           text,
  address_mismatch      boolean not null default false,  -- KBO-adres ≠ adressenregister
  address_struck_off    jsonb,
  lat                   double precision,
  lon                   double precision,
  geo_quality           text not null default 'missing'
                          check (geo_quality in ('ok', 'placeholder', 'missing', 'outside_municipality')),
  phone                 text,
  email                 text,
  nace_rsz              text,
  nace_rsz_description  text,
  source                text not null,
  source_retrieved_at   timestamptz,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index establishments_enterprise_idx on public.establishments (enterprise_number);
create index establishments_street_idx on public.establishments (municipality_id, kbo_street);
create index enterprises_street_idx on public.enterprises (seat_municipality_id, seat_street);

-- ---------------------------------------------------------------------------
-- evidence — één observatie uit één bron, altijd traceerbaar
-- ---------------------------------------------------------------------------
create table public.evidence (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_number     text references public.enterprises(enterprise_number),
  establishment_number  text references public.establishments(establishment_number),
  source                text not null
                          check (source in ('vkbo', 'kbo_api', 'google_places', 'jaarrekening', 'officer')),
  source_record_id      text,            -- bv. Google place_id
  evidence_type         text not null
                          check (evidence_type in ('legal_status', 'business_status', 'opening_hours', 'website',
                                                   'phone', 'email', 'address', 'activity', 'annual_account',
                                                   'strike_off', 'place_match', 'no_result')),
  value                 jsonb not null default '{}',
  summary_nl            text not null,   -- leesbare observatie voor de medewerker
  url                   text,
  observed_at           date,            -- datum van het feit zelf, indien bekend
  retrieved_at          timestamptz not null default now(),
  match_quality         text check (match_quality in ('exact', 'probable', 'uncertain')),
  match_details         jsonb,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  constraint evidence_subject check (enterprise_number is not null or establishment_number is not null)
);
create index evidence_enterprise_idx on public.evidence (enterprise_number);
create index evidence_establishment_idx on public.evidence (establishment_number);

-- ---------------------------------------------------------------------------
-- analysis — voorstel van het uitlegbare regelmodel
-- ---------------------------------------------------------------------------
create table public.analysis (
  id                    uuid primary key default gen_random_uuid(),
  subject_type          text not null check (subject_type in ('enterprise', 'establishment')),
  enterprise_number     text references public.enterprises(enterprise_number),
  establishment_number  text references public.establishments(establishment_number),
  proposed_status       text not null
                          check (proposed_status in ('active_likely', 'temporarily_closed', 'possibly_inactive',
                                                     'conflict_manual_check', 'address_issue', 'insufficient_evidence')),
  confidence            text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  summary_nl            text not null,
  reasons               jsonb not null default '[]',  -- [{rule, text_nl, effect, evidence_ids}]
  evidence_ids          uuid[] not null default '{}',
  model_version         text not null,
  is_current            boolean not null default true,
  created_at            timestamptz not null default now(),
  constraint analysis_subject check (
    (subject_type = 'enterprise' and enterprise_number is not null and establishment_number is null) or
    (subject_type = 'establishment' and establishment_number is not null)
  )
);
create unique index analysis_current_enterprise on public.analysis (enterprise_number)
  where is_current and subject_type = 'enterprise';
create unique index analysis_current_establishment on public.analysis (establishment_number)
  where is_current and subject_type = 'establishment';

-- ---------------------------------------------------------------------------
-- officer_reviews — beslissing van de medewerker (append-only audit)
-- ---------------------------------------------------------------------------
create table public.officer_reviews (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references public.analysis(id),
  decision      text not null check (decision in ('confirmed', 'rejected')),
  final_status  text check (final_status in ('active_likely', 'temporarily_closed', 'possibly_inactive',
                                             'conflict_manual_check', 'address_issue', 'insufficient_evidence')),
  comment       text,
  reviewer      text not null check (length(trim(reviewer)) > 0),
  reviewed_at   timestamptz not null default now()
);
create index officer_reviews_analysis_idx on public.officer_reviews (analysis_id);

-- ---------------------------------------------------------------------------
-- api_usage — harde teller om kosten van externe API's te begrenzen
-- ---------------------------------------------------------------------------
create table public.api_usage (
  source  text not null,
  day     date not null default current_date,
  count   integer not null default 0,
  primary key (source, day)
);

-- Atomair verhogen; faalt (returns false) als de daglimiet bereikt is.
create or replace function public.consume_api_quota(p_source text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare new_count integer;
begin
  insert into api_usage (source, day, count) values (p_source, current_date, 1)
  on conflict (source, day) do update set count = api_usage.count + 1
  where api_usage.count < p_limit
  returning count into new_count;
  return new_count is not null;
end $$;
revoke all on function public.consume_api_quota(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Alle registerrecords in een straat: vestigingen + zetels van ondernemingen.
create view public.street_records with (security_invoker = true) as
select
  'establishment'::text                          as subject_type,
  e.establishment_number                          as record_number,
  e.enterprise_number,
  e.establishment_number,
  e.municipality_id,
  coalesce(nullif(e.commercial_name, ''), e.name) as display_name,
  e.name                                          as official_name,
  e.kbo_street                                    as street,
  e.kbo_house_number                              as house_number,
  e.kbo_box                                       as box,
  e.lat, e.lon, e.geo_quality,
  e.address_mismatch,
  ent.legal_status_norm                           as enterprise_legal_status,
  ent.completeness                                as enterprise_completeness,
  ent.seat_municipality                           as enterprise_seat_municipality,
  a.id                                            as analysis_id,
  a.proposed_status,
  a.confidence,
  r.decision                                      as last_decision,
  r.reviewed_at                                   as last_reviewed_at
from public.establishments e
join public.enterprises ent on ent.enterprise_number = e.enterprise_number
left join public.analysis a on a.establishment_number = e.establishment_number and a.is_current
left join lateral (
  select decision, reviewed_at from public.officer_reviews orv
  where orv.analysis_id = a.id order by reviewed_at desc limit 1
) r on true
union all
select
  'enterprise', ent.enterprise_number, ent.enterprise_number, null,
  ent.seat_municipality_id,
  coalesce(nullif(ent.commercial_name, ''), ent.name), ent.name,
  ent.seat_street, ent.seat_house_number, ent.seat_box,
  ent.seat_lat, ent.seat_lon, ent.seat_geo_quality,
  false,
  ent.legal_status_norm, ent.completeness, ent.seat_municipality,
  a.id, a.proposed_status, a.confidence,
  r.decision, r.reviewed_at
from public.enterprises ent
left join public.analysis a on a.enterprise_number = ent.enterprise_number and a.is_current and a.subject_type = 'enterprise'
left join lateral (
  select decision, reviewed_at from public.officer_reviews orv
  where orv.analysis_id = a.id order by reviewed_at desc limit 1
) r on true
where ent.seat_municipality_id is not null and ent.completeness = 'full';

-- Enkel door een medewerker bevestigde voorstellen verlaten de tool.
create view public.approved_changes with (security_invoker = true) as
select
  r.id as review_id, r.reviewed_at, r.reviewer, r.comment,
  coalesce(r.final_status, a.proposed_status) as status,
  a.proposed_status, a.confidence, a.model_version,
  a.subject_type, a.enterprise_number, a.establishment_number, a.evidence_ids
from public.officer_reviews r
join public.analysis a on a.id = r.analysis_id
where r.decision = 'confirmed';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Frontend (anon): lezen + reviews toevoegen. Schrijven van register, evidence en
-- analysis gebeurt enkel via import-script of Edge Functions (service role).
-- MVP zonder login: reviewer is een naamveld.
-- ---------------------------------------------------------------------------
alter table public.municipalities  enable row level security;
alter table public.enterprises     enable row level security;
alter table public.establishments  enable row level security;
alter table public.evidence        enable row level security;
alter table public.analysis        enable row level security;
alter table public.officer_reviews enable row level security;
alter table public.api_usage       enable row level security;

create policy "lezen" on public.municipalities  for select to anon, authenticated using (true);
create policy "lezen" on public.enterprises     for select to anon, authenticated using (true);
create policy "lezen" on public.establishments  for select to anon, authenticated using (true);
create policy "lezen" on public.evidence        for select to anon, authenticated using (true);
create policy "lezen" on public.analysis        for select to anon, authenticated using (true);
create policy "lezen" on public.officer_reviews for select to anon, authenticated using (true);
create policy "review toevoegen" on public.officer_reviews for insert to anon, authenticated with check (true);
-- geen update/delete-policies op officer_reviews: auditlog blijft onveranderlijk

grant select on public.street_records, public.approved_changes to anon, authenticated;
