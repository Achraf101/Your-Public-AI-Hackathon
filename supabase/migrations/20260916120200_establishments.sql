-- ============================================================================
-- establishments - de vestigingseenheid (de fysieke plek)
-- ----------------------------------------------------------------------------
-- Dit is wat de ambtenaar op straat kan gaan bekijken. Eén onderneming kan
-- meerdere vestigingen hebben, en de maatschappelijke zetel kan ergens anders
-- liggen dan de vestiging. Die relatie blijft hier bewaard via enterprise_id;
-- we platten onderneming en vestiging nooit samen tot één rij.
--
-- Ook de maatschappelijke zetel zelf krijgt een rij in deze tabel, met
-- is_maatschappelijke_zetel = true. Anders zou het zeteladres nergens bewaard
-- worden en kun je "zetel elders" niet van "vestiging hier" onderscheiden.
-- ============================================================================

create table if not exists public.establishments (
  id                          text        primary key,

  -- VKBO: Ondernemingsnr_maatsch_zetel. Wijst naar de onderneming waar deze
  -- vestiging juridisch onder hangt.
  enterprise_id               text        not null
    references public.enterprises (id)
    on update cascade
    on delete restrict,

  is_maatschappelijke_zetel   boolean     not null default false,

  -- Adres zoals het KBO het kent.
  straat                      text,
  huisnr                      text,
  postcode                    text,
  gemeente                    text,

  -- Adres zoals het Vlaamse Adressenregister het kent (de validatie).
  ar_straat                   text,
  ar_huisnr                   text,
  ar_postcode                 text,

  -- Afgeleid: leeg ar_straat betekent dat het adres niet gevalideerd kon worden.
  adres_gevalideerd           boolean generated always as (public.vkbo_adres_gevalideerd(straat, ar_straat)) stored,

  -- Wordt in een latere stap gevuld (bv. veel inschrijvingen op één woonadres).
  is_domicilieadres_verdacht  boolean     not null default false,

  -- Afgeleid uit de rechtsvorm van de gekoppelde onderneming. Wordt door een
  -- trigger gezet, niet door de applicatie: de rechtsvorm staat in VKBO alleen
  -- op de onderneming-rij, nooit op de vestigingsrij.
  is_vme                      boolean     not null default false,

  latitude                    double precision,
  longitude                   double precision,

  bron                        text        not null default 'vkbo',
  opgehaald_op                timestamptz not null default now(),

  constraint establishments_id_formaat
    check (id ~ '^[0-9]{10}$'),
  constraint establishments_latitude_bereik
    check (latitude is null or latitude between -90 and 90),
  constraint establishments_longitude_bereik
    check (longitude is null or longitude between -180 and 180),
  -- Coördinaten komen als paar of helemaal niet.
  constraint establishments_coordinaten_compleet
    check ((latitude is null) = (longitude is null)),
  -- De zetelrij van een onderneming draagt het ondernemingsnummer zelf.
  constraint establishments_zetel_is_eigen_nummer
    check (not is_maatschappelijke_zetel or id = enterprise_id)
);

comment on table public.establishments is
  'De vestigingseenheid: de fysieke plek waar een onderneming actief is. Eén onderneming kan meerdere vestigingen hebben. De rij met is_maatschappelijke_zetel = true is het juridische zeteladres, niet noodzakelijk een plek waar iets te zien is.';

comment on column public.establishments.id is
  'Vestigingseenheidsnummer (VKBO: Ondernemingsnr op een vestigingsrij), 10 cijfers als TEKST. Vestigingsnummers beginnen met 2, ondernemingsnummers met 0 of 1.';
comment on column public.establishments.enterprise_id is
  'VKBO: Ondernemingsnr_maatsch_zetel. De onderneming waar deze vestiging onder hangt. Ontbreekt die onderneming in de export, maak dan eerst een placeholder met zorg_voor_onderneming().';
comment on column public.establishments.is_maatschappelijke_zetel is
  'TRUE = dit is het juridische zeteladres van de onderneming, niet per se een handelszaak. Een boekhoudersadres of woonkamer telt ook als zetel.';
comment on column public.establishments.straat is
  'VKBO: KBO_Straat. Het adres zoals het register het kent.';
comment on column public.establishments.huisnr is 'VKBO: KBO_Huisnr.';
comment on column public.establishments.postcode is 'VKBO: KBO_Postcode.';
comment on column public.establishments.gemeente is 'VKBO: KBO_Gemeente.';
comment on column public.establishments.ar_straat is
  'VKBO: AR_straat, de straat volgens het Vlaamse Adressenregister. Leeg = het KBO-adres kon niet gevalideerd worden.';
comment on column public.establishments.ar_huisnr is 'VKBO: AR_huisnr.';
comment on column public.establishments.ar_postcode is 'VKBO: AR_postcode.';
comment on column public.establishments.adres_gevalideerd is
  'Afgeleid: TRUE als het adressenregister dezelfde straat teruggeeft als het KBO. FALSE is een signaal voor de ambtenaar, geen bewijs van inactiviteit.';
comment on column public.establishments.is_domicilieadres_verdacht is
  'Nog niet gevuld. Bedoeld voor adressen die er als brievenbusadres uitzien, bv. veel inschrijvingen op één woonadres.';
comment on column public.establishments.is_vme is
  'Afgeleid uit de rechtsvorm van de gekoppelde onderneming. Wordt door een trigger onderhouden - zet deze kolom niet zelf.';
comment on column public.establishments.latitude is 'Uit de VKBO GeoJSON (EPSG:4326).';
comment on column public.establishments.longitude is 'Uit de VKBO GeoJSON (EPSG:4326).';
comment on column public.establishments.opgehaald_op is
  'Wanneer deze registergegevens opgehaald zijn. VKBO loopt 1 tot 3 dagen achter op het federale KBO.';

create index if not exists establishments_enterprise_id_idx
  on public.establishments (enterprise_id);

create index if not exists establishments_gemeente_postcode_idx
  on public.establishments (gemeente, postcode);

-- Zoeken per straat: de vraag van de ambtenaar is meestal "wat staat er in
-- de Paalstraat?".
create index if not exists establishments_gemeente_straat_idx
  on public.establishments (gemeente, straat);

-- Werklijst: niet-gevalideerde adressen zijn kandidaten voor controle.
create index if not exists establishments_adres_niet_gevalideerd_idx
  on public.establishments (id)
  where not adres_gevalideerd;

-- ----------------------------------------------------------------------------
-- is_vme synchroon houden met de rechtsvorm van de onderneming.
-- ----------------------------------------------------------------------------

create or replace function public.zet_establishment_is_vme()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(public.vkbo_is_vme(e.rechtsvorm), false)
    into new.is_vme
    from public.enterprises e
   where e.id = new.enterprise_id;

  -- Onderneming nog niet verrijkt (placeholder): voorlopig false. De trigger
  -- hieronder corrigeert dit zodra de rechtsvorm bekend is.
  new.is_vme := coalesce(new.is_vme, false);
  return new;
end;
$$;

drop trigger if exists establishments_zet_is_vme on public.establishments;
create trigger establishments_zet_is_vme
  before insert or update of enterprise_id on public.establishments
  for each row
  execute function public.zet_establishment_is_vme();

create or replace function public.sync_vestigingen_is_vme()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.establishments
     set is_vme = coalesce(public.vkbo_is_vme(new.rechtsvorm), false)
   where enterprise_id = new.id
     and is_vme is distinct from coalesce(public.vkbo_is_vme(new.rechtsvorm), false);
  return null;
end;
$$;

drop trigger if exists enterprises_sync_vestigingen_is_vme on public.enterprises;
create trigger enterprises_sync_vestigingen_is_vme
  after update of rechtsvorm on public.enterprises
  for each row
  when (old.rechtsvorm is distinct from new.rechtsvorm)
  execute function public.sync_vestigingen_is_vme();

comment on function public.zet_establishment_is_vme() is
  'Leidt is_vme af uit de rechtsvorm van de gekoppelde onderneming; de vestigingsrij in VKBO draagt zelf geen rechtsvorm.';
comment on function public.sync_vestigingen_is_vme() is
  'Werkt is_vme van alle vestigingen bij wanneer de rechtsvorm van de onderneming verandert, bv. wanneer een placeholder verrijkt wordt.';
