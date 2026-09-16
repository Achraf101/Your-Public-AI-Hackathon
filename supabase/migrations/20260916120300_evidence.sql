-- ============================================================================
-- evidence - publiek bewijs naast het register
-- ----------------------------------------------------------------------------
-- Append-only logboek. Elke waarneming uit een publieke bron krijgt een eigen
-- rij en wordt nooit overschreven: zo staat het register naast het bewijs en
-- zie je ook dat bewijs van vorige maand anders was.
--
-- Deze tabel bevat waarnemingen, geen conclusies. De conclusie staat in
-- beoordelingen, met de redenen erbij.
-- ============================================================================

create table if not exists public.evidence (
  id                uuid        primary key default gen_random_uuid(),

  establishment_id  text        not null
    references public.establishments (id)
    on update cascade
    on delete cascade,

  bron              text        not null,
  type              text        not null,

  -- Leesbare samenvatting die de ambtenaar te zien krijgt, bv. "OPERATIONAL"
  -- of "laatste review 3 maanden geleden".
  waarde            text,

  -- De onbewerkte respons van de bron. Bewaren we zodat een beoordeling altijd
  -- terug te voeren is op wat de bron echt zei - niet op onze interpretatie.
  ruwe_payload      jsonb,

  bron_url          text,
  opgehaald_op      timestamptz not null default now(),
  aangemaakt_op     timestamptz not null default now(),

  constraint evidence_bron_niet_leeg
    check (public.vkbo_tekst(bron) is not null),
  constraint evidence_type_niet_leeg
    check (public.vkbo_tekst(type) is not null),
  -- Een waarneming zonder inhoud is geen bewijs.
  constraint evidence_heeft_inhoud
    check (public.vkbo_tekst(waarde) is not null or ruwe_payload is not null)
);

comment on table public.evidence is
  'Publiek bewijs per vestiging, append-only. Waarnemingen, geen conclusies. Nooit overschrijven: een nieuwe ophaling is een nieuwe rij.';

comment on column public.evidence.establishment_id is
  'De vestiging waarover deze waarneming gaat.';
comment on column public.evidence.bron is
  'Waar het bewijs vandaan komt: "google_places", "nbb_jaarrekening", "handmatig", "vkbo", ...  Bewust geen vaste lijst, zodat een nieuwe bron geen migratie vereist.';
comment on column public.evidence.type is
  'Wat er waargenomen is: "status", "review", "foto", "website", "telefoon", "openingsuren", ...';
comment on column public.evidence.waarde is
  'Leesbare samenvatting voor de ambtenaar. Laat leeg als er niets bekend is - vul hier nooit een gok in.';
comment on column public.evidence.ruwe_payload is
  'Onbewerkte respons van de bron, voor controle achteraf.';
comment on column public.evidence.bron_url is
  'Link naar de bron, zodat de ambtenaar het zelf kan nakijken.';
comment on column public.evidence.opgehaald_op is
  'Wanneer de waarneming gedaan is. Een openingsstatus van een jaar oud is zwakker bewijs dan één van vandaag.';

create index if not exists evidence_establishment_id_idx
  on public.evidence (establishment_id);

-- Meest gebruikte query: het recentste bewijs voor één vestiging.
create index if not exists evidence_establishment_recent_idx
  on public.evidence (establishment_id, opgehaald_op desc);

create index if not exists evidence_bron_type_idx
  on public.evidence (bron, type);

-- Budgetbewaking: hoeveel calls hebben we deze maand aan een bron besteed?
-- Relevant voor Google Places (beperkt budget) en NBB (nog 10 requests).
create index if not exists evidence_bron_opgehaald_idx
  on public.evidence (bron, opgehaald_op desc);
