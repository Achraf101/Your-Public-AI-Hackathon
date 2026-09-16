-- ============================================================================
-- Find the Real Businesses - hulpfuncties
-- ----------------------------------------------------------------------------
-- Deze functies zetten de eigenaardigheden van de VKBO-bron om in bruikbare
-- waarden. Ze zijn IMMUTABLE zodat ze gebruikt kunnen worden in GENERATED
-- kolommen en CHECK-constraints.
--
-- Twee eigenaardigheden van de bron die je moet kennen:
--   1. "leeg" is in VKBO een string met een spatie (" "), niet NULL en niet "".
--   2. datums gebruiken placeholders: 1900-01-01 (= niet van toepassing) en
--      9999-12-31 (= nog niet afgesloten).
--
-- Alle functies staan op `set search_path = ''` en noemen ingebouwde functies
-- bij hun volledige naam (pg_catalog.btrim, ...). COALESCE, NULLIF en casts
-- zijn SQL-constructies, geen functies: die blijven onveranderd.
-- ============================================================================

-- Normaliseert een VKBO-tekstveld: spaties weg, " " en "" worden NULL.
create or replace function public.vkbo_tekst(p_waarde text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_waarde), '');
$$;

comment on function public.vkbo_tekst(text) is
  'Normaliseert een VKBO-tekstveld. VKBO levert lege velden als " " (spatie); deze functie maakt daar NULL van.';

-- Is dit een echte datum, of een VKBO-placeholder (1900-01-01 / 9999-12-31)?
create or replace function public.vkbo_is_echte_datum(p_datum date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_datum is not null
     and p_datum <> '1900-01-01'::date
     and p_datum <> '9999-12-31'::date;
$$;

comment on function public.vkbo_is_echte_datum(date) is
  'TRUE als de datum een echte gebeurtenis is. VKBO gebruikt 1900-01-01 en 9999-12-31 als placeholder voor "geen datum".';

-- Vergelijkingssleutel voor straatnamen: kleine letters, alleen letters/cijfers.
-- "Alice Nahonlei" en "alice  nahonlei" worden zo gelijk.
create or replace function public.vkbo_straat_sleutel(p_straat text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
           pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.btrim(coalesce(p_straat, ''))),
             '[^[:alnum:]]', '', 'g'),
           '');
$$;

comment on function public.vkbo_straat_sleutel(text) is
  'Normaliseert een straatnaam tot een vergelijkingssleutel (kleine letters, leestekens en spaties verwijderd).';

-- Adresvalidatie: het KBO-adres is gevalideerd wanneer het Vlaamse
-- Adressenregister (AR_straat) een straat teruggeeft die overeenkomt met de
-- straat uit het KBO. Is AR_straat leeg terwijl KBO_Straat gevuld is, dan kon
-- het adres NIET gevalideerd worden - een signaal om te tonen aan de ambtenaar.
create or replace function public.vkbo_adres_gevalideerd(p_kbo_straat text, p_ar_straat text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.vkbo_straat_sleutel(p_ar_straat) is not null
     and public.vkbo_straat_sleutel(p_kbo_straat) is not null
     and public.vkbo_straat_sleutel(p_ar_straat) = public.vkbo_straat_sleutel(p_kbo_straat);
$$;

comment on function public.vkbo_adres_gevalideerd(text, text) is
  'TRUE als het adressenregister (AR_straat) het KBO-adres bevestigt. FALSE betekent: niet gevalideerd, toon dit aan de ambtenaar.';

-- Vereniging van Mede-eigenaars: juridisch een onderneming, maar in de praktijk
-- een appartementsgebouw en nooit een winkel op straat. In de Schoten-steekproef
-- is 105 van de 1000 registerinschrijvingen een VME. Deze eruit kunnen filteren
-- scheelt de ambtenaar meteen ~10% ruis.
create or replace function public.vkbo_is_vme(p_rechtsvorm text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
           public.vkbo_tekst(p_rechtsvorm) ilike '%mede-eigenaar%'
        or public.vkbo_tekst(p_rechtsvorm) ilike '%mede eigenaar%',
           false);
$$;

comment on function public.vkbo_is_vme(text) is
  'TRUE als de rechtsvorm een Vereniging van Mede-eigenaars is (appartementsgebouw, geen handelszaak).';

-- Valideert de transparantie-eis: redenen is een niet-lege JSON-array van
-- strings. Elke beoordeling moet uitlegbaar zijn - geen black box.
create or replace function public.is_redenenlijst(p_redenen jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_redenen is not null
     and pg_catalog.jsonb_typeof(p_redenen) = 'array'
     and pg_catalog.jsonb_array_length(p_redenen) > 0
     and not pg_catalog.jsonb_path_exists(
               p_redenen,
               '$[*] ? (@.type() != "string")'::pg_catalog.jsonpath);
$$;

comment on function public.is_redenenlijst(jsonb) is
  'TRUE als redenen een niet-lege JSON-array van strings is. Dwingt af dat elke beoordeling haar signalen apart en leesbaar opsomt.';
