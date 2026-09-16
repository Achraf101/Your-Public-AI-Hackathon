-- ============================================================================
-- beoordelingen - voorstellen aan de ambtenaar
-- ----------------------------------------------------------------------------
-- Elke rij is een VOORSTEL, nooit een doorgevoerde wijziging. Een voorstel
-- blijft "te_controleren" tot een ambtenaar het bevestigt of afwijst. Het
-- schema dwingt dat af: zie de constraint beoordelingen_beslissing_compleet.
--
-- Zekerheid is altijd Hoog / Middel / Laag, nooit een los percentage, en altijd
-- met de redenen erbij - elk signaal apart, zodat de ambtenaar ziet waarop het
-- voorstel gebaseerd is.
-- ============================================================================

create table if not exists public.beoordelingen (
  id                  uuid        primary key default gen_random_uuid(),

  -- Nullable: bij voorgestelde_status 'mogelijk_ontbrekend' gaat het net om een
  -- zaak die wél op straat staat maar géén inschrijving heeft. Dan is er nog
  -- geen vestiging om naar te verwijzen.
  establishment_id    text
    references public.establishments (id)
    on update cascade
    on delete cascade,

  zekerheid           text        not null,
  redenen             jsonb       not null,
  voorgestelde_status text        not null,
  voorstel_tekst      text,

  status              text        not null default 'te_controleren',
  beoordeeld_door     text,
  beoordeeld_op       timestamptz,
  aangemaakt_op       timestamptz not null default now(),

  constraint beoordelingen_zekerheid_geldig
    check (zekerheid in ('Hoog', 'Middel', 'Laag')),

  constraint beoordelingen_status_geldig
    check (status in ('te_controleren', 'bevestigd', 'afgewezen')),

  constraint beoordelingen_voorgestelde_status_geldig
    check (voorgestelde_status in (
      'actief',
      'waarschijnlijk_actief',
      'onzeker',
      'waarschijnlijk_inactief',
      'mogelijk_ontbrekend',
      'kbo_niet_op_adres'
    )),

  -- Geen black box: er moet altijd minstens één leesbare reden staan.
  constraint beoordelingen_redenen_zijn_lijst
    check (public.is_redenenlijst(redenen)),

  -- Niets wordt automatisch doorgevoerd: zolang een voorstel openstaat is er
  -- geen beoordelaar, en zodra het bevestigd of afgewezen is moet vastliggen
  -- wie dat deed en wanneer.
  constraint beoordelingen_beslissing_compleet
    check (
      (status = 'te_controleren'
        and beoordeeld_door is null
        and beoordeeld_op is null)
      or
      (status in ('bevestigd', 'afgewezen')
        and public.vkbo_tekst(beoordeeld_door) is not null
        and beoordeeld_op is not null)
    ),

  -- Een voorstel zonder vestiging kan alleen over een ontbrekende zaak gaan,
  -- en moet dan zelf beschrijven waarover het gaat.
  constraint beoordelingen_zonder_vestiging
    check (
      establishment_id is not null
      or (voorgestelde_status = 'mogelijk_ontbrekend'
          and public.vkbo_tekst(voorstel_tekst) is not null)
    )
);

comment on table public.beoordelingen is
  'Voorstellen aan de economieambtenaar. Nooit een doorgevoerde wijziging: een voorstel staat op te_controleren tot iemand het bevestigt of afwijst.';

comment on column public.beoordelingen.establishment_id is
  'De vestiging waarover het voorstel gaat. NULL bij voorgestelde_status mogelijk_ontbrekend: dan bestaat de inschrijving nog niet.';
comment on column public.beoordelingen.zekerheid is
  'Hoog, Middel of Laag. Bewust geen percentage: een score van 0,73 suggereert een precisie die we niet hebben.';
comment on column public.beoordelingen.redenen is
  'JSON-array van strings, elk signaal apart, zowel plus als min. Bijvoorbeeld: ["Google Places meldt OPERATIONAL", "review van 2 weken geleden", "adres niet gevalideerd in het adressenregister"]. Minstens één reden verplicht.';
comment on column public.beoordelingen.voorgestelde_status is
  'actief | waarschijnlijk_actief | onzeker | waarschijnlijk_inactief | mogelijk_ontbrekend (staat op straat, niet in het register) | kbo_niet_op_adres (ingeschreven adres klopt niet).';
comment on column public.beoordelingen.voorstel_tekst is
  'De concrete tekst van het voorstel, bv. een adrescorrectie of de naam en het adres van een gevonden zaak die niet in het register staat.';
comment on column public.beoordelingen.status is
  'te_controleren (open voorstel) | bevestigd | afgewezen. Alleen een mens zet dit op bevestigd of afgewezen.';
comment on column public.beoordelingen.beoordeeld_door is
  'Wie het voorstel behandeld heeft. Verplicht zodra status niet meer te_controleren is.';
comment on column public.beoordelingen.beoordeeld_op is
  'Wanneer het voorstel behandeld is. Verplicht zodra status niet meer te_controleren is.';

create index if not exists beoordelingen_establishment_id_idx
  on public.beoordelingen (establishment_id);

-- De werklijst van de ambtenaar: open voorstellen, hoogste zekerheid eerst.
create index if not exists beoordelingen_openstaand_idx
  on public.beoordelingen (zekerheid, aangemaakt_op desc)
  where status = 'te_controleren';

create index if not exists beoordelingen_voorgestelde_status_idx
  on public.beoordelingen (voorgestelde_status);

-- Zaken die wél op straat staan maar niet in het register: aparte lijst,
-- want die hebben geen vestiging om op te zoeken.
create index if not exists beoordelingen_ontbrekend_idx
  on public.beoordelingen (aangemaakt_op desc)
  where establishment_id is null;
