-- ============================================================================
-- Row Level Security
-- ----------------------------------------------------------------------------
-- In Supabase is een tabel zónder RLS via de publieke anon-key voor iedereen
-- leesbaar én schrijfbaar. Voor een tool die nooit automatisch iets mag
-- publiceren is dat geen optie, dus: alles dicht, daarna gericht openzetten.
--
--   anon          - geen toegang (geen enkele policy)
--   authenticated - mag alles lezen, en beoordelingen bevestigen of afwijzen
--   service_role  - de ingest-pipeline; omzeilt RLS en heeft geen policy nodig
-- ============================================================================

alter table public.enterprises    enable row level security;
alter table public.establishments enable row level security;
alter table public.evidence       enable row level security;
alter table public.beoordelingen  enable row level security;

drop policy if exists "ingelogde gebruikers lezen ondernemingen"        on public.enterprises;
drop policy if exists "ingelogde gebruikers lezen vestigingen"          on public.establishments;
drop policy if exists "ingelogde gebruikers lezen bewijs"               on public.evidence;
drop policy if exists "ingelogde gebruikers lezen beoordelingen"        on public.beoordelingen;
drop policy if exists "ingelogde gebruikers beoordelen voorstellen"     on public.beoordelingen;
drop policy if exists "ingelogde gebruikers voegen handmatig bewijs toe" on public.evidence;

-- ---------------------------------------------------------------- lezen ----
create policy "ingelogde gebruikers lezen ondernemingen"
  on public.enterprises
  for select
  to authenticated
  using (true);

create policy "ingelogde gebruikers lezen vestigingen"
  on public.establishments
  for select
  to authenticated
  using (true);

create policy "ingelogde gebruikers lezen bewijs"
  on public.evidence
  for select
  to authenticated
  using (true);

create policy "ingelogde gebruikers lezen beoordelingen"
  on public.beoordelingen
  for select
  to authenticated
  using (true);

-- ------------------------------------------------- beoordelen (de mens) ----
-- De ambtenaar bevestigt of wijst af. Alleen deze ene schrijfbewerking is
-- toegestaan vanuit de applicatie; de rest van het register wordt uitsluitend
-- door de pipeline (service_role) geschreven.
create policy "ingelogde gebruikers beoordelen voorstellen"
  on public.beoordelingen
  for update
  to authenticated
  using (true)
  with check (true);

-- Een ambtenaar mag ook zelf een waarneming vastleggen (bron 'handmatig'),
-- bv. na een plaatsbezoek.
create policy "ingelogde gebruikers voegen handmatig bewijs toe"
  on public.evidence
  for insert
  to authenticated
  with check (bron = 'handmatig');
