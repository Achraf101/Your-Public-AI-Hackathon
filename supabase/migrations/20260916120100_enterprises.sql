-- ============================================================================
-- enterprises - de juridische entiteit (onderneming)
-- ----------------------------------------------------------------------------
-- Eén rij per ondernemingsnummer. Dit is NIET de plek waar het bedrijf op
-- straat staat: dat is een vestigingseenheid (zie establishments).
--
-- Het ondernemingsnummer wordt als TEKST bewaard. Het is geen getal:
-- "0415708742" casten naar integer maakt er 415708742 van en dan klopt de
-- koppeling met het register niet meer.
-- ============================================================================

create table if not exists public.enterprises (
  id                text        primary key,
  naam              text,
  handelsnaam       text,
  rechtsvorm        text,
  rechtstoestand    text,
  datum_stopzetting date,

  -- Afgeleid, niet handmatig te zetten: GENERATED kolommen worden door
  -- Postgres berekend en geweigerd bij een INSERT die ze meegeeft.
  is_gestopt        boolean generated always as (public.vkbo_is_echte_datum(datum_stopzetting)) stored,
  is_vme            boolean generated always as (public.vkbo_is_vme(rechtsvorm)) stored,

  -- TRUE = deze rij bestaat alleen om de zetel-koppeling van een vestiging te
  -- kunnen leggen; de onderneming zelf is nog niet opgehaald. Zie README.
  is_placeholder    boolean     not null default false,

  bron              text        not null default 'vkbo',
  opgehaald_op      timestamptz not null default now(),

  constraint enterprises_id_formaat
    check (id ~ '^[0-9]{10}$'),
  constraint enterprises_bron_niet_leeg
    check (public.vkbo_tekst(bron) is not null)
);

comment on table public.enterprises is
  'De juridische entiteit uit het KBO. Eén rij per ondernemingsnummer. De fysieke plekken staan in establishments.';

comment on column public.enterprises.id is
  'Ondernemingsnummer (VKBO: Ondernemingsnr), 10 cijfers, als TEKST zodat leidende nullen behouden blijven. Nooit naar een getal casten.';
comment on column public.enterprises.naam is
  'VKBO: Maatschappelijke_naam. De juridische naam.';
comment on column public.enterprises.handelsnaam is
  'VKBO: Commerciele_naam. De naam op de gevel - vaak leeg, en vaak anders dan de maatschappelijke naam.';
comment on column public.enterprises.rechtsvorm is
  'VKBO: Rechtsvorm. Staat enkel op onderneming-rijen, niet op vestigingsrijen.';
comment on column public.enterprises.rechtstoestand is
  'VKBO: Rechtstoestand, bv. "Normale toestand", "Opening faillissement", "Vervroegde ontbinding - Vereffening". Een sterker signaal dan is_gestopt: in de Schoten-steekproef stond 0 van de 1000 inschrijvingen als gestopt, maar wel 35 in ontbinding of faillissement.';
comment on column public.enterprises.datum_stopzetting is
  'VKBO: Datum_stopzetting, ruw bewaard inclusief placeholder 1900-01-01. Gebruik is_gestopt om te filteren.';
comment on column public.enterprises.is_gestopt is
  'Afgeleid: TRUE als datum_stopzetting een echte datum is (dus niet de placeholder 1900-01-01 of 9999-12-31).';
comment on column public.enterprises.is_vme is
  'Afgeleid uit rechtsvorm: Vereniging van Mede-eigenaars (appartementsgebouw, geen handelszaak).';
comment on column public.enterprises.is_placeholder is
  'TRUE = stub-rij, enkel aangemaakt zodat een vestiging haar zetel kan aanwijzen. Naam en rechtsvorm zijn nog onbekend omdat de zetel buiten de opgehaalde gemeente ligt. Toon zo een rij nooit als "onderneming zonder naam" aan de ambtenaar.';
comment on column public.enterprises.bron is
  'Waar deze rij vandaan komt: "vkbo" (opgehaald uit de VKBO-API) of "afgeleid_uit_vestiging" (placeholder).';
comment on column public.enterprises.opgehaald_op is
  'Wanneer deze registergegevens opgehaald zijn. Nodig om aan de ambtenaar te tonen hoe vers het register is.';

create index if not exists enterprises_rechtstoestand_idx
  on public.enterprises (rechtstoestand);

-- Werklijst-index: de ondernemingen die aandacht vragen.
create index if not exists enterprises_gestopt_idx
  on public.enterprises (id)
  where is_gestopt;

-- Placeholders zijn de rijen die nog verrijkt moeten worden.
create index if not exists enterprises_placeholder_idx
  on public.enterprises (id)
  where is_placeholder;

-- ----------------------------------------------------------------------------
-- Maakt een stub-onderneming aan zodat een vestiging haar zetel kan aanwijzen.
-- Nodig omdat een gemeentelijke export bijna altijd vestigingen bevat waarvan
-- de maatschappelijke zetel elders ligt: in de Schoten-steekproef ontbrak de
-- moederonderneming bij 515 van de 543 vestigingen.
-- Doet niets wanneer de onderneming al bestaat - overschrijft dus nooit
-- echte gegevens met een lege stub.
-- ----------------------------------------------------------------------------
create or replace function public.zorg_voor_onderneming(p_ondernemingsnr text)
returns void
language sql
set search_path = ''
as $$
  insert into public.enterprises (id, bron, is_placeholder)
  select public.vkbo_tekst(p_ondernemingsnr), 'afgeleid_uit_vestiging', true
  where public.vkbo_tekst(p_ondernemingsnr) is not null
  on conflict (id) do nothing;
$$;

comment on function public.zorg_voor_onderneming(text) is
  'Maakt indien nodig een placeholder-onderneming aan, zodat een vestiging haar maatschappelijke zetel kan aanwijzen. Overschrijft nooit bestaande gegevens.';
