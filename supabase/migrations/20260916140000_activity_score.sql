-- MVP v2: zoeken op naam/adres/nummer + activiteitsscore.

-- Activiteitsscore (0–100) + label naast confidence (zekerheid).
alter table public.analysis
  add column activity_score integer check (activity_score between 0 and 100),
  add column activity_label text check (activity_label in ('active', 'likely_active', 'uncertain', 'likely_inactive', 'inactive'));

-- Nieuwe bronnen/types: websitecheck en Staatsblad-publicaties (via jaarrekening.be).
alter table public.evidence drop constraint evidence_source_check;
alter table public.evidence add constraint evidence_source_check
  check (source in ('vkbo', 'kbo_api', 'google_places', 'jaarrekening', 'website', 'officer'));
alter table public.evidence drop constraint evidence_evidence_type_check;
alter table public.evidence add constraint evidence_evidence_type_check
  check (evidence_type in ('legal_status', 'business_status', 'opening_hours', 'website', 'phone', 'email', 'address',
                           'activity', 'annual_account', 'publication', 'website_check', 'strike_off', 'place_match', 'no_result', 'error'));

-- Gemeenten: bounding box voor coördinaatcontrole (minLon, minLat, maxLon, maxLat).
alter table public.municipalities add column bbox double precision[];

insert into public.municipalities (nis_code, name, postcodes, province, bbox) values
  ('11040', 'Schoten',    '{2900}',                     'Antwerpen', '{4.44,51.22,4.61,51.33}'),
  ('11008', 'Brasschaat', '{2930}',                     'Antwerpen', '{4.43,51.26,4.56,51.35}'),
  ('11057', 'Wijnegem',   '{2110}',                     'Antwerpen', '{4.49,51.21,4.56,51.25}'),
  ('11039', 'Schilde',    '{2970}',                     'Antwerpen', '{4.52,51.21,4.65,51.29}'),
  ('11009', 'Brecht',     '{2960}',                     'Antwerpen', '{4.55,51.27,4.73,51.40}'),
  ('13040', 'Turnhout',   '{2300}',                     'Antwerpen', '{4.87,51.28,5.01,51.37}'),
  ('12025', 'Mechelen',   '{2800,2801,2811,2812}',      'Antwerpen', '{4.39,50.98,4.55,51.07}')
on conflict (nis_code) do update set bbox = excluded.bbox, postcodes = excluded.postcodes;

-- Quotum met dag- én maandlimiet (Google moet binnen het gratis volume blijven).
create or replace function public.consume_api_quota_v2(p_source text, p_amount integer, p_daily_limit integer, p_monthly_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today_count integer;
  month_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('api_quota:' || p_source));
  select coalesce(sum(count) filter (where day = current_date), 0),
         coalesce(sum(count), 0)
    into today_count, month_count
    from api_usage
   where source = p_source and day >= date_trunc('month', current_date)::date;
  if today_count + p_amount > p_daily_limit or month_count + p_amount > p_monthly_limit then
    return false;
  end if;
  insert into api_usage (source, day, count) values (p_source, current_date, p_amount)
  on conflict (source, day) do update set count = api_usage.count + p_amount;
  return true;
end $$;
revoke all on function public.consume_api_quota_v2(text, integer, integer, integer) from public, anon, authenticated;

-- Verbruik zichtbaar voor de medewerker (enkel tellers, geen geheimen).
create view public.api_usage_month with (security_invoker = false) as
select source,
       coalesce(sum(count) filter (where day = current_date), 0)::int as today,
       sum(count)::int as this_month
  from public.api_usage
 where day >= date_trunc('month', current_date)::date
 group by source;
grant select on public.api_usage_month to anon, authenticated;
