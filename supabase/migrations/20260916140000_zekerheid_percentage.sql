-- ============================================================================
-- beoordelingen.zekerheid_percentage - de kans als getal naast de band
-- ----------------------------------------------------------------------------
-- Het oorspronkelijke model toonde bewust alleen Hoog/Middel/Laag, om geen
-- precisie te suggereren die er niet is. De ambtenaar wil echter kunnen zien
-- HOE hoog "Hoog" is: 70% en 95% staan allebei op "Hoog", maar vragen een heel
-- andere reactie. Daarom bewaren we vanaf nu allebei.
--
-- Het percentage is géén nieuw, los model: het is een vaste herschaling van
-- dezelfde opgetelde signaalscore die ook de band bepaalt (zie
-- scripts/lib/confidence-engine.js, percentageVanScore). De redenenlijst
-- blijft verplicht, dus het getal is altijd na te rekenen - geen black box.
--
--   score  -4   -3   -2   -1    0    1    2    3    4
--   pct     5%   8%  17%  31%  50%  69%  83%  92%  95%
--   band   Laag Laag Laag Laag  Mid  Mid Hoog Hoog Hoog
--
-- Afgetopt op 5-95: acht publieke signalen zijn nooit volledige zekerheid.
-- ============================================================================

alter table public.beoordelingen
  add column if not exists zekerheid_percentage smallint;

-- Bestaande rijen (geschreven vóór deze migratie) hebben alleen een band.
-- We vullen ze met het midden van hun band, zodat sorteren op percentage
-- meteen werkt en de kolom not null kan worden.
update public.beoordelingen
   set zekerheid_percentage = case zekerheid
                                when 'Hoog'   then 83
                                when 'Middel' then 50
                                else 17
                              end
 where zekerheid_percentage is null;

alter table public.beoordelingen
  alter column zekerheid_percentage set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.beoordelingen'::regclass
       and conname = 'beoordelingen_zekerheid_percentage_geldig'
  ) then
    alter table public.beoordelingen
      add constraint beoordelingen_zekerheid_percentage_geldig
      check (zekerheid_percentage between 0 and 100);
  end if;
end $$;

-- Band en percentage mogen elkaar nooit tegenspreken: dezelfde drempels als in
-- confidence-engine.js (ZEKERHEID_DREMPEL_HOOG / _MIDDEL). Zo kan een rij met
-- "Hoog" nooit 20% zijn, ook niet als iemand rechtstreeks in de tabel schrijft.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.beoordelingen'::regclass
       and conname = 'beoordelingen_zekerheid_past_bij_percentage'
  ) then
    alter table public.beoordelingen
      add constraint beoordelingen_zekerheid_past_bij_percentage
      check (
        (zekerheid = 'Hoog'   and zekerheid_percentage >= 70)
        or (zekerheid = 'Middel' and zekerheid_percentage >= 40 and zekerheid_percentage < 70)
        or (zekerheid = 'Laag'   and zekerheid_percentage < 40)
      );
  end if;
end $$;

comment on column public.beoordelingen.zekerheid_percentage is
  'Kans (0-100, in de praktijk 5-95) dat de zaak echt actief is op dit adres. Vaste herschaling van de signaalscore, niet van een extra model; altijd na te rekenen via redenen. Moet overeenstemmen met de band in zekerheid.';

comment on column public.beoordelingen.zekerheid is
  'Hoog (>= 70%), Middel (40-69%) of Laag (< 40%) - de band van zekerheid_percentage, voor kleuren, filters en sortering.';

-- De werklijst sorteert op het percentage (laagste kans eerst), niet meer op de
-- band: binnen "Laag" maakt 8% versus 31% wel degelijk uit.
create index if not exists beoordelingen_openstaand_percentage_idx
  on public.beoordelingen (zekerheid_percentage, aangemaakt_op desc)
  where status = 'te_controleren';
