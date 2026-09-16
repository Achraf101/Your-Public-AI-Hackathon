-- ============================================================================
-- NACE-activiteitscodes — nodig voor de domicilieadres-bevestigingscheck
-- (prompt 4): "meerdere vestigingen op een verdacht adres, met sterk
-- uiteenlopende NACE-codes/activiteiten" kan enkel gecontroleerd worden als we
-- die codes ook bewaren.
-- ----------------------------------------------------------------------------
-- VKBO plaatst dit veld op twee verschillende plekken, en beide zijn nuttig:
--
--  - NACE_hoofdact_BTW hoort bij de ONDERNEMING (Rechtspersoon-rijen). In de
--    Paalstraat-steekproef was dit voor 97 van de 142 ondernemingen gevuld.
--  - NACE_hoofdact_RSZ verschijnt soms rechtstreeks op de VESTIGINGSRIJ zelf
--    (een vestiging kan een andere hoofdactiviteit hebben dan de zetel), maar
--    is er veel spaarzamer: 81 van de 237 vestigingen in dezelfde steekproef.
--
-- De vulgraad op vestigingsniveau is dus laag; de domicilie-check valt voor
-- vestigingen zonder eigen NACE_RSZ terug op de NACE_BTW van de moeder-
-- onderneming (zie scripts/lib/domicilie.js). Vandaar kolommen op BEIDE
-- tabellen in plaats van één plek.
-- ============================================================================

alter table public.enterprises
  add column if not exists nace_code_btw text,
  add column if not exists nace_omschrijving_btw text;

comment on column public.enterprises.nace_code_btw is
  'VKBO: NACE_hoofdact_BTW. Hoofdactiviteit van de onderneming volgens de BTW-aangifte, bv. "68110".';
comment on column public.enterprises.nace_omschrijving_btw is
  'VKBO: Omschrijving_hoofdact_BTW, bv. "Handel in eigen onroerend goed".';

alter table public.establishments
  add column if not exists nace_code_rsz text,
  add column if not exists nace_omschrijving_rsz text;

comment on column public.establishments.nace_code_rsz is
  'VKBO: NACE_hoofdact_RSZ. Hoofdactiviteit van DEZE vestiging volgens de RSZ (kan afwijken van de NACE_BTW van de moederonderneming), maar veel spaarzamer ingevuld. NULL is normaal, geen fout.';
comment on column public.establishments.nace_omschrijving_rsz is
  'VKBO: Omschrijving_hoofdact_RSZ.';

-- Eerste twee cijfers van een NACE-code = de "afdeling" (bv. 68 = vastgoed,
-- 47 = kleinhandel). Op dat niveau vergelijken we activiteiten: twee
-- vastgoedkantoren met codes 68110 en 68310 horen bij dezelfde sector, ook al
-- is de code niet identiek.
create or replace function public.nace_afdeling (p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.vkbo_tekst(p_code) ~ '^[0-9]{2}'
    then pg_catalog.substring(public.vkbo_tekst(p_code), 1, 2)
    else null
  end;
$$;

comment on function public.nace_afdeling (text) is
  'Eerste 2 cijfers van een NACE-code (de "afdeling"/sector). NULL als de code leeg of onherkenbaar is.';
