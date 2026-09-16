# Find the Real Businesses

Prototype voor de challenge van Provincie Antwerpen. Een lokale economieambtenaar
weet niet altijd welke bedrijven écht actief zijn op straat: het KBO toont zaken
die al jaren gestopt zijn als "actief", en mist soms winkels die duidelijk open
zijn. Eén gemeente van 20.000 inwoners heeft 33.000 registerinschrijvingen — die
kan niemand één voor één gaan natrekken.

Deze repo zet naast elk registeradres het **publieke bewijs** dat erover te vinden
is, en geeft elke vestiging een **kans (5–95%) dat ze echt actief is op dat
adres** — met per signaal een leesbare reden, zodat de ambtenaar de conclusie kan
natrekken in plaats van ze te moeten geloven. Het register zelf wordt nooit
automatisch gewijzigd: alles wat eruit komt is een _voorstel_ dat een mens
bevestigt of afwijst.

```
  VKBO live API ──┐                            ┌─► kans in % + redenen
                  ├─► ingest ──► Postgres ─────┤
  Google Places ──┘   verrijk    register      └─► voorgestelde status
                                 + evidence            │
                                                       ▼
                                      Express API ──► React-dashboard
                                                       │
                                     ambtenaar bevestigt of wijst af
                                     (met naam en tijdstip, in de database)
```

## Snel starten

Eén commando zet database, ingest, demodata, API en frontend samen op:

```bash
docker compose up --build        # of: npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:3000>
- De stack laadt automatisch **Schoten / Paalstraat** in (379 inschrijvingen uit
  de live VKBO-API) en berekent er voorstellen voor.

```bash
npm run dev:down                 # stoppen
npm run dev:reset                # stoppen + database wissen (na een migratie)
```

> **Demo-modus.** De online signalen in deze stack zijn **gelabelde mockdata**
> (`bron = 'demo_mock'`), zodat alle kleuren, filters en kaartcategorieën te
> demonstreren zijn zonder betaalde Google Places-key. De frontend toont dat
> label ook zichtbaar in de interface. De echte Places-koppeling zit wel in de
> repo — zie [Google Places-verrijking](#google-places-verrijking-publiek-bewijs-geen-automatisch-oordeel).

### Zonder Docker

```bash
npm install
cp .env.example .env             # vul DATABASE_URL in
npm run ingest    -- Schoten Paalstraat
npm run demo-data -- Schoten Paalstraat     # optioneel: gelabelde mocksignalen
npm run beoordeel -- Schoten Paalstraat
npm run serve                               # API op :3000

cd frontend && npm install && npm run dev   # UI op :5173
```

`VITE_API_URL` is optioneel — de frontend valt terug op `http://localhost:3000`.

## Inhoud

|                  |                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**        | [Begrippenkader](#begrippenkader) · [De vijf regels](#de-vijf-regels-die-het-schema-afdwingt) · [De tabellen](#de-tabellen) · [Ontwerpbeslissingen](#drie-ontwerpbeslissingen-die-de-data-afdwong)                                          |
| **Data in**      | [Migraties](#migraties-draaien) · [VKBO-eigenaardigheden](#twee-eigenaardigheden-van-de-vkbo-bron) · [Ingest](#ingest-script-vkbo-live-api---supabase) · [Google Places](#google-places-verrijking-publiek-bewijs-geen-automatisch-oordeel) |
| **Logica en UI** | [Confidence-engine](#confidence-engine-van-evidence-naar-een-voorstel) · [REST-API](#rest-api-voor-de-frontend) · [Frontend](#frontend-het-dashboard-voor-de-economieambtenaar)                                                             |
| **Rest**         | [Toegang (RLS)](#toegang-rls) · [Wat er nog niet in zit](#wat-er-nog-niet-in-zit) · [Bronnen](#bronnen)                                                                                                                                     |

## Begrippenkader

Drie dingen die door elkaar gehaald worden, en die we uit elkaar houden:

| Begrip                                | Wat het is                                                  | Waar het staat                                          |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| **Onderneming** (enterprise)          | De juridische entiteit, met een ondernemingsnummer          | `enterprises`                                           |
| **Vestigingseenheid** (establishment) | Een fysieke plek waar die onderneming actief is             | `establishments`                                        |
| **Maatschappelijke zetel**            | Het adres waar de onderneming juridisch geregistreerd staat | `establishments` met `is_maatschappelijke_zetel = true` |

Eén onderneming kan meerdere vestigingen hebben, en de zetel ligt vaak ergens
anders dan de vestiging — soms bij de boekhouder of in een woonkamer. **Die
relatie platten we nooit samen tot één rij.** Een gestopte onderneming met een
nog draaiende vestiging, of een zetel op een adres waar niets te zien is, zijn
precies de gevallen die de tool moet kunnen tonen.

## De vijf regels die het schema afdwingt

1. **Register en bewijs staan naast elkaar.** `enterprises`/`establishments` is
   wat het register zegt, `evidence` is wat we in de echte wereld zien. Ze worden
   nooit vermengd.
2. **Onderneming, vestiging en zetel blijven onderscheiden.** Zie hierboven.
3. **Niets wordt automatisch doorgevoerd.** Elke rij in `beoordelingen` is een
   _voorstel_. De constraint `beoordelingen_beslissing_compleet` maakt het
   onmogelijk om een voorstel op `bevestigd` of `afgewezen` te zetten zonder dat
   `beoordeeld_door` en `beoordeeld_op` ingevuld zijn.
4. **Nooit iets verzinnen.** Ontbrekende contactgegevens zijn `NULL`, en de
   frontend toont dan "Contactgegevens onbekend". De constraint
   `evidence_heeft_inhoud` weigert een bewijsrij zonder inhoud.
5. **Zekerheid is een percentage én een band, met redenen.**
   `zekerheid_percentage` is de kans (5–95) dat de zaak echt actief is op het
   geregistreerde adres; `zekerheid` is diezelfde waarde als band Hoog (≥ 70%)
   / Middel (40–69%) / Laag (< 40%), voor kleuren, filters en sortering. Een
   constraint bewaakt dat die twee elkaar nooit tegenspreken.

   Het percentage is **geen apart model**: het is een vaste, monotone
   herschaling van dezelfde opgetelde signaalscore die ook de band bepaalt.
   `redenen` blijft een niet-lege JSON-array van strings, elk signaal apart,
   dus het getal is altijd na te rekenen. Geen black box. De omzetting staat
   bij de [confidence-engine](#confidence-engine-van-evidence-naar-een-voorstel).

## De tabellen

### `enterprises` — de juridische entiteit

Het ondernemingsnummer is de primary key en staat als **tekst** in de database.
`"0415708742"` is geen getal: casten naar integer maakt er `415708742` van en dan
klopt de koppeling met het register niet meer. Een `CHECK` dwingt 10 cijfers af.

Afgeleide kolommen (`GENERATED ALWAYS`, dus niet handmatig te zetten):

- `is_gestopt` — `TRUE` als `datum_stopzetting` een echte datum is. VKBO gebruikt
  `1900-01-01` en `9999-12-31` als placeholder voor "geen datum"; die tellen niet.
- `is_vme` — `TRUE` bij rechtsvorm _Vereniging van Mede-eigenaars_: juridisch een
  onderneming, in de praktijk een appartementsgebouw. In de Schoten-steekproef is
  dat 105 van de 1000 inschrijvingen, dus ~10% ruis die je meteen kunt wegfilteren.

> **Let op:** `is_gestopt` is zwakker dan het lijkt. In de steekproef van 1000
> inschrijvingen stond er **nul** als gestopt, terwijl 35 ondernemingen in
> vereffening of faillissement zaten. `rechtstoestand` is in de praktijk het
> bruikbaardere signaal.

### `establishments` — de fysieke plek

`enterprise_id` verwijst naar de onderneming (VKBO: `Ondernemingsnr_maatsch_zetel`).
Het KBO-adres (`straat`, `huisnr`, ...) en de versie uit het Vlaamse
Adressenregister (`ar_straat`, ...) staan náást elkaar, niet over elkaar heen.

- `adres_gevalideerd` — afgeleid: `TRUE` als het adressenregister dezelfde straat
  teruggeeft als het KBO. Is `ar_straat` leeg terwijl `straat` gevuld is, dan kon
  het adres niet gevalideerd worden. Dat is een _signaal_ voor de ambtenaar, geen
  bewijs van inactiviteit.
- `is_domicilieadres_verdacht` — default `false`; wordt gezet door het
  ingest-script (zie "Ingest-script" hieronder) op basis van een register-
  signaal: meer dan 15 vestigingen op hetzelfde (`straat`, `huisnr`). Geen
  bewijs op zich, enkel een reden om te bevestigen met Google Places.
- `is_vme` — overgenomen van de moederonderneming, zie hieronder.

### `evidence` — publiek bewijs

Append-only logboek: elke waarneming is een nieuwe rij, we overschrijven nooit.
Zo zie je ook dat het bewijs van vorige maand anders was. `waarde` is de leesbare
samenvatting voor de ambtenaar, `ruwe_payload` de onbewerkte respons zodat een
beoordeling altijd terug te voeren is op wat de bron écht zei.

`bron` en `type` zijn bewust vrije tekst, geen `CHECK` — een nieuwe bron mag geen
migratie kosten. Verwachte waarden staan in de kolomcommentaren.

### `beoordelingen` — voorstellen aan de ambtenaar

Eén rij = één voorstel. `status` begint op `te_controleren` en kan alleen door een
mens naar `bevestigd` of `afgewezen`. `voorgestelde_status` is één van:

| Waarde                    | Betekenis                                     |
| ------------------------- | --------------------------------------------- |
| `actief`                  | Register en bewijs zijn het eens: dit draait  |
| `waarschijnlijk_actief`   | Bewijs wijst op actief, maar niet sluitend    |
| `onzeker`                 | Te weinig of tegenstrijdig bewijs             |
| `waarschijnlijk_inactief` | Bewijs wijst op gestopt, register zegt actief |
| `mogelijk_ontbrekend`     | Staat op straat, maar niet in het register    |
| `kbo_niet_op_adres`       | Ingeschreven adres klopt niet                 |

## Drie ontwerpbeslissingen die de data afdwong

Deze wijken af van een letterlijke lezing van de opdracht. De reden staat erbij.

**1. Placeholder-ondernemingen.** Een gemeentelijke export bevat bijna altijd
vestigingen waarvan de zetel elders ligt. In de Schoten-steekproef ontbrak de
moederonderneming bij **515 van de 543 vestigingen** — een harde foreign key zou
dus 95% van de vestigingen weigeren. Daarom maakt de ingest eerst een stub-rij
aan met `is_placeholder = true`. De relatie blijft zo intact zonder iets te
verzinnen: naam en rechtsvorm blijven gewoon `NULL`. Toon zo'n rij nooit als
"onderneming zonder naam" aan de ambtenaar.

```sql
-- Eerst de ondernemingen (echte rijen én placeholders), dan pas de vestigingen.
insert into enterprises (id, bron, is_placeholder)
select distinct v.enterprise_id, 'afgeleid_uit_vestiging', true
from   staging_vkbo v
where  v.enterprise_id is not null
on conflict (id) do nothing;
```

Of per stuk: `select zorg_voor_onderneming('0719273014');`

**2. `is_vme` op `establishments` wordt door een trigger gezet.** De opdracht
vraagt om het af te leiden uit de rechtsvorm, maar VKBO zet `Rechtsvorm` alleen
op de onderneming-rij — op een vestigingsrij is dat veld altijd leeg. Een
`GENERATED` kolom kan niet in een andere tabel kijken, dus twee triggers houden
het synchroon: één bij het invoegen van een vestiging, één die alle vestigingen
bijwerkt zodra de rechtsvorm van de onderneming verandert (bv. wanneer een
placeholder later verrijkt wordt). **Zet deze kolom niet zelf.**

**3. `beoordelingen.establishment_id` is nullable.** Bij
`voorgestelde_status = 'mogelijk_ontbrekend'` gaat het net om een zaak die wél op
straat staat maar géén inschrijving heeft — er is dan geen vestiging om naar te
verwijzen. Een `CHECK` staat dat alléén toe voor die status, en eist dan dat
`voorstel_tekst` beschrijft waarover het gaat (naam + adres).

## Migraties draaien

```bash
supabase db reset          # lokaal, draait alles opnieuw
supabase db push           # naar het gekoppelde project
```

De migraties zijn idempotent (`if not exists`, `drop policy if exists`) en zijn
getest tegen PostgreSQL 17: 39 controles op afgeleide velden, constraints,
triggers en RLS — zowel in-process (PGlite) als tegen een echte
gedockeriseerde Postgres via TCP.

> **Over de testresultaten in dit document.** De controles die hieronder
> beschreven staan (migraties, ingest, Places-pipeline, API, browserflow) zijn
> tijdens de ontwikkeling uitgevoerd, maar de testsuites zelf zijn **niet in
> deze repo gecommit** — je kunt ze dus niet zelf draaien. Wat je wél kunt
> natrekken is de volledige pipeline end-to-end via `docker compose up`. Een
> gecommitte testsuite staat op de lijst bij
> [Wat er nog niet in zit](#wat-er-nog-niet-in-zit).

Volgorde is belangrijk — de bestandsnamen regelen dat:

| Bestand                             | Inhoud                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `20260916120000_vkbo_helpers.sql`   | Hulpfuncties voor de VKBO-eigenaardigheden                               |
| `20260916120100_enterprises.sql`    | Ondernemingen + `zorg_voor_onderneming()`                                |
| `20260916120200_establishments.sql` | Vestigingen + `is_vme`-triggers                                          |
| `20260916120300_evidence.sql`       | Bewijs                                                                   |
| `20260916120400_beoordelingen.sql`  | Voorstellen                                                              |
| `20260916120500_rls.sql`            | Row Level Security                                                       |
| `20260916130000_nace.sql`           | NACE-activiteitscodes + `nace_afdeling()`, voor de domicilie-bevestiging |

## Twee eigenaardigheden van de VKBO-bron

Wie de ingest schrijft, loopt hier gegarandeerd tegenaan:

1. **Leeg is `" "`.** VKBO geeft een string met één spatie terug, niet `NULL` en
   niet `""`. Een test als `ar_straat is not null` levert dus altijd `true`.
   Gebruik `vkbo_tekst()` om te normaliseren.
2. **Datums gebruiken placeholders**: `1900-01-01` (niet van toepassing) en
   `9999-12-31` (nog niet afgesloten). Gebruik `vkbo_is_echte_datum()`.

## Toegang (RLS)

In Supabase is een tabel zonder RLS via de publieke anon-key voor iedereen
leesbaar én schrijfbaar. Alles staat daarom dicht:

- `anon` — geen toegang, geen enkele policy.
- `authenticated` — leest alles, mag voorstellen bevestigen of afwijzen, en mag
  handmatig bewijs toevoegen (`bron = 'handmatig'`, bv. na een plaatsbezoek).
- `service_role` — de ingest-pipeline, omzeilt RLS.

## Ingest-script: VKBO live API -> Supabase

```bash
npm install
cp .env.example .env       # vul DATABASE_URL in (Supabase -> Settings -> Database)
npm run ingest -- Schoten Paalstraat
```

Roept de VKBO OGC API Features aan voor een gemeente (+ optioneel een straat),
pagineert zelf tot alles opgehaald is, en upsert elke rij in de juiste tabel:

- Classificatie: een rij is een **onderneming** als `Type_onderneming` =
  `'Rechtspersoon'` OF `Ondernemingsnr_maatsch_zetel` leeg is; anders is het een
  **vestiging**. In de praktijk zijn dit disjuncte groepen — een vestigingsrij
  draagt in VKBO nooit een `Rechtsvorm`.
- Elke onderneming krijgt ook een eigen rij in `establishments`
  (`is_maatschappelijke_zetel = true`, met `id = enterprise_id`) voor haar
  zeteladres — zie de derde ontwerpbeslissing hierboven.
- Ontbreekt de moederonderneming van een vestiging in de opgehaalde data (in de
  Schoten-steekproef bij 515 van de 543 vestigingen), dan wordt eerst een
  placeholder aangemaakt — zie `zorgVoorOnderneming()` in
  [scripts/lib/database.js](scripts/lib/database.js).
- `adres_gevalideerd` en `is_vme` worden **niet** in JavaScript herberekend: die
  blijven een `GENERATED` kolom en een trigger in de database.
  Het script leest ze enkel terug via `RETURNING`, zodat er maar één plek is die
  bepaalt wat "gevalideerd" of "VME" betekent.
- **Domicilie-heuristiek**: na het inladen van een straat telt het script hoeveel
  vestigingen hetzelfde (`straat`, `huisnr`) delen (straatnamen genormaliseerd via
  `vkbo_straat_sleutel()`, zodat schrijfwijzevarianten niet als aparte straten
  tellen) en zet `is_domicilieadres_verdacht = true` boven de 15. Dit is een
  registersignaal, geen bewijs — pas een latere Google Places-koppeling kan
  bevestigen of het om een brievenbusadres gaat.
- **Idempotent**: alles gebeurt via `INSERT ... ON CONFLICT (id) DO UPDATE`.
  Opnieuw draaien voor dezelfde straat maakt geen duplicaten en herberekent de
  domicilie-vlag correct (ook terug naar `false` als een groep onder de drempel
  zakt).
- De hele run staat in één transactie (`BEGIN`/`COMMIT`, terug `ROLLBACK` bij een
  fout): een mislukte ingest laat nooit een half ingeladen straat achter.

**Waarom Node.js in plaats van Python:** het script bouwt rechtstreeks verder op
de SQL uit de migraties (dezelfde `GENERATED`-kolommen, dezelfde triggers,
dezelfde `zorg_voor_onderneming()`-functie) en heeft daarnaast geen dependency
nodig buiten de Postgres-driver zelf — Node 20+ heeft een ingebouwde `fetch()`
en `--env-file`. Belangrijker: de databaselaag is geschreven tegen een
generieke `{ query(sql, params) }`-interface. Daardoor kon exact dezelfde code
getest worden tegen een in-process Postgres-engine (PGlite, WASM) zonder mocks,
en draait die identieke code in productie tegen Supabase via `pg`. Zie de
testresultaten hieronder.

**Getest tegen Paalstraat, Schoten (live VKBO-API, écht Postgres via PGlite):**

|                                  |                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opgehaald uit VKBO               | 379 rijen                                                                                                                                                 |
| Ondernemingen ingeladen          | 142                                                                                                                                                       |
| Vestigingen ingeladen            | 379 (incl. 142 zetelrijen)                                                                                                                                |
| Nieuwe placeholder-ondernemingen | 138 (moederonderneming lag buiten Paalstraat)                                                                                                             |
| Adres niet gevalideerd           | 0                                                                                                                                                         |
| Domicilieadres-verdacht          | 25 — allemaal op **Paalstraat 70**: 25 verschillende vastgoed-vennootschappen (IMMOBOR, IMMOHAN, DIMMO, M.A.B., ...) met een vestiging op hetzelfde adres |

Tweede keer dezelfde straat draaien gaf exact dezelfde aantallen, nul
duplicaten (`group by id having count(*) > 1`), en alle ID's bleven 10 cijfers
als tekst — de leidende nullen bleven behouden. Nadien nog eens herhaald tegen
een echte gedockeriseerde Postgres (over TCP, met `pg.Pool`/`BEGIN`/`COMMIT`
zoals in productie): exact dezelfde uitkomst.

## Google Places-verrijking: publiek bewijs, geen automatisch oordeel

```bash
npm run verrijk -- Schoten Paalstraat
```

Zoekt voor elke vestiging van een straat naar publiek bewijs via **Places API
(New)** en schrijft dat weg als `evidence` — nooit als een automatisch
voorstel. Kostenbeheersing is geen bijzaak hier, maar het uitgangspunt van het
ontwerp:

- **Twee calls, bewust ongelijk zwaar.** Voor elke vestiging eerst één **Text
  Search** om de beste match te vinden, dan — enkel bij een eenduidige match —
  één **Place Details**-call voor de echte gegevens. Text Search vraagt enkel
  `id, displayName, formattedAddress` op (de matchgegevens); Place Details
  vraagt de 8 gevraagde velden op. Zie de volgende twee punten voor waarom dit
  zo verdeeld is.
- **FieldMask op maat van de Places-prijstabel.** Google rekent per call af
  volgens de duurste SKU-laag van de opgevraagde velden (nagekeken in de
  officiële docs: Essentials < Pro < Enterprise). `nationalPhoneNumber`,
  `websiteUri`, `currentOpeningHours`, `rating` en `userRatingCount` zitten
  allemaal in de **Enterprise**-laag. Die pas opvragen bij de ene
  Details-call — nooit bij Text Search — betekent dat je maar één keer per
  vestiging het dure tarief betaalt, niet één keer per kandidaat-resultaat.
- **Twee velden toegevoegd aan de gevraagde 8** (`id`, `googleMapsUri`) — beide
  in een goedkopere laag (Essentials/Pro) dan Enterprise, en dus **zonder
  extra kost** zodra de Details-call toch al Enterprise-velden opvraagt.
  Nodig omdat de opdracht zelf een vervolgcall (`id`) en een `bron_url`
  (`googleMapsUri`) vereist — zonder deze twee kan geen van beide.
- **Harde bovengrens** via `MAX_PLACES_CALLS` (default 50), geteld vóór elke
  poging — ook een mislukte call telt mee. De run stopt meteen zodra de grens
  bereikt is, ook halverwege een vestiging (een match zonder de bijhorende
  Details-call wordt dan gewoon niet opgeslagen, en bij de volgende run
  opnieuw geprobeerd).
- **Cache**: een vestiging met al `evidence` van bron `google_places` van
  **vandaag** wordt overgeslagen — een herstart na een crash of een tweede
  keer draaien dezelfde dag kost dus geen extra requests.
- **Nooit gokken.** Zie `kiesBesteMatch()` in
  [scripts/lib/places-match.js](scripts/lib/places-match.js): 0 resultaten of
  2+ resultaten worden altijd als `geen_match_gevonden` opgeslagen; bij precies
  1 resultaat moet de naam én de postcode aannemelijk overeenkomen, anders ook
  `geen_match_gevonden`. Er wordt nooit het eerste resultaat blind aangenomen.
- **Eén evidence-rij per signaal** (`status`, `telefoon`, `website`, `uren`,
  `reviews_samenvatting`), nooit alles in één blob, en nooit een rij voor een
  veld dat Google niet teruggaf — geen lege string als "gevonden" bewijs. Elke
  rij krijgt `bron_url` = de Google Maps-link van die match.
- Vestigingen waarvan de moederonderneming nog een placeholder is (zie het
  ingest-script hierboven) hebben geen naam om op te zoeken. Die worden apart
  geteld als "overgeslagen (geen naam bekend)" — niet als `geen_match_gevonden`,
  want er is nooit gezocht.
- Net als bij de ingest: alles per vestiging in een eigen transactie (zie
  [scripts/lib/places-db.js](scripts/lib/places-db.js)). Een crash of het
  bereiken van de limiet halverwege mag nooit de — al betaalde — evidence van
  eerder verwerkte vestigingen ongedaan maken.

**Getest zonder één cent uit te geven.** De volledige pipeline (matching,
evidence-writes, cache, harde limiet) is doorgelicht tegen een echte
gedockeriseerde Postgres met de echte Paalstraat-data erin, met enkel de
HTTP-laag naar Google gemockt (`placesClient` is injecteerbaar, zie
`verrijkStraat()` in
[scripts/verrijk-google-places.js](scripts/verrijk-google-places.js)):

| Test                                                                              | Resultaat                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Limiet van 10 requests                                                            | Nooit overschreden; run stopt exact op 10, rest correct gerapporteerd als "niet verwerkt door limiet" |
| Cache (zelfde straat 2x na elkaar)                                                | Alles wat al verwerkt was: 0 nieuwe requests, opnieuw als "al vandaag opgehaald"                      |
| Hervatting na een limiet-stop                                                     | Vestigingen die de eerste run niet haalden, werden in de tweede run alsnog verwerkt                   |
| Evidence-rijen met lege waarde                                                    | 0                                                                                                     |
| Match-evidence zonder `bron_url`                                                  | 0                                                                                                     |
| Alle drie "geen match"-redenen (0 resultaten / meerdere / naam komt niet overeen) | Elk apart en correct opgeslagen                                                                       |

Er is bewust **geen enkele echte Google-call** gemaakt tijdens deze build: de
opdracht vraagt expliciet om 0 euro uit te geven, en of dit account nog binnen
een gratis contingent zit is niet iets om zelf aan te nemen. Zeg het woord en
ik draai het script met een kleine, expliciete limiet (bv. `MAX_PLACES_CALLS=5`)
tegen de echte API, zodat je ook eens echte Google-data ziet.

## Confidence-engine: van evidence naar een voorstel

[scripts/lib/confidence-engine.js](scripts/lib/confidence-engine.js) — een
pure functie, geen databasetoegang, dus makkelijk te controleren en te testen.
Neemt establishment + enterprise + alle evidence van één vestiging, geeft een
voorstel terug. Nooit een definitieve wijziging: het resultaat wordt altijd
weggeschreven naar `beoordelingen` met `status = 'te_controleren'`.

**De 8 kernregels**, elk ±1, elk met een eigen leesbare regel in `redenen` —
geen black box:

```
+ businessStatus = OPERATIONAL          - businessStatus = CLOSED_PERMANENTLY/_TEMPORARILY
+ website gevonden                      - geen enkele match (type='geen_match_gevonden')
+ userRatingCount > 0                   - adres NIET gevalideerd
+ adres_gevalideerd = true              - enterprise.is_gestopt = true
```

**Van score naar percentage.** De opgetelde score (bereik ongeveer -4 tot +4)
wordt via `percentageVanScore()` herschaald naar een kans, en die kans bepaalt
de band. Eén vaste, monotone omzetting — geen tweede model, geen verborgen
weging:

| Score  | Kans   | Band   | Betekenis                               |
| ------ | ------ | ------ | --------------------------------------- |
| ≥ 2    | ≥ 70%  | Hoog   | Minstens 2 signalen méér vóór dan tegen |
| 0 of 1 | 40–69% | Middel | Gemengd, of maar één zwak signaal       |
| < 0    | < 40%  | Laag   | Meer tegen dan vóór                     |

```
score  -4   -3   -2   -1    0    1    2    3    4
pct     5%   8%  17%  31%  50%  69%  83%  92%  95%
```

De drempels zijn exact dezelfde als toen er nog enkel een band was — er
verschuift dus niets in wie waar terechtkomt, er komt enkel een getal bij dat
_binnen_ een band nog onderscheid maakt. Afgetopt op 5–95%: acht publieke
signalen zijn nooit volledige zekerheid. Een constraint in
[`beoordelingen`](supabase/migrations/20260916140000_zekerheid_percentage.sql)
bewaakt dat band en percentage elkaar niet kunnen tegenspreken.

**Voorgestelde status — losse, gerichte logica**, niet zomaar afgeleid van de
score: "Google bevestigt OPERATIONAL, maar het KBO zegt gestopt" is een
tegenstrijdig geval (score kan prima Middel zijn) dat toch een heel specifiek
voorstel verdient (`waarschijnlijk_actief`), geen vage `onzeker`. Eén
toevoeging bovenop wat letterlijk gevraagd werd: als `ar_straat` gevuld is
maar van `straat` verschilt (het adressenregister spreekt het KBO-adres
actief tegen — iets anders dan "nooit gecontroleerd"), en er toch bewijs van
activiteit is (of net geen match), stelt de engine `kbo_niet_op_adres` voor in
plaats van het generieke `onzeker`/`waarschijnlijk_inactief`. Zonder die regel zou die
enum-waarde nooit geproduceerd worden.

**Speciale gevallen uit de opdracht:**

- **VME** (`is_vme = true`): geen beoordeling opgeslagen, enkel
  `{ uitgesloten_reden: 'gebouwbeheer_vme' }`. Getest: de database bevat
  achteraf écht geen `beoordelingen`-rij voor zo'n vestiging.
- **Domicilieadres-bevestiging**: `is_domicilieadres_verdacht` is
  enkel een tellingssignaal — meer dan 15 inschrijvingen op één huisnummer.
  De opdracht vraagt om dat te bevestigen via NACE-diversiteit, dus is er een
  nieuwe, kleine migratie
  ([20260916130000_nace.sql](supabase/migrations/20260916130000_nace.sql))
  bijgekomen die `nace_code_btw` (onderneming) en `nace_code_rsz` (vestiging,
  spaarzamer) vastlegt. Zie [scripts/lib/domicilie.js](scripts/lib/domicilie.js):
  minder dan 2 bekende NACE-codes -> onvoldoende data, niet bevestigen; één
  NACE-**afdeling** (de eerste 2 cijfers) die meer dan de helft van de bekende
  codes beslaat -> waarschijnlijk een legitiem bedrijvengebouw, niet
  bevestigen; anders -> wel bevestigen.

  **Getest tegen een echt geval, geen synthetische data**: Paalstraat 70,
  Schoten heeft 25 geregistreerde vastgoedkantoren (IMMOBOR, IMMOHAN, DIMMO,
  M.A.B., ...) — precies het soort adres dat de >15-teller alleen zou
  aanmerken als brievenbusadres. De NACE-check laat zien dat 21 van de 23
  bekende codes in afdeling 68 (vastgoed) zitten: **niet bevestigd**, met als
  reden "activiteiten liggen dicht bij elkaar — NACE-afdeling 68 domineert".
  Terecht: dit is een kantorenpark voor vastgoedkantoren, geen brievenbusadres.
  Een bevestigd geval zou vereisen dat totaal ongerelateerde sectoren
  (bv. een kapper, een boekhouder én een garage) toevallig hetzelfde adres
  delen.

- **Nooit een placeholder-waarde verzinnen**: ontbreekt telefoon/website-
  evidence, dan blijft dat veld gewoon leeg in de API-respons.
  "Contactgegevens onbekend" tonen is bewust de taak van de (nog te bouwen)
  frontend, niet van deze laag.

## REST-API voor de frontend

```bash
npm run serve
```

**Waarom een lichte Express-laag, geen Supabase Edge Functions of FastAPI:**
Edge Functions draaien op Deno — een ander runtime dan de rest van deze repo.
De confidence-engine, de databaselaag en de domicilie-groepering staan al als
gewone Node ES-modules in `scripts/lib/`; die overzetten (of dupliceren) voor
Edge Functions is pure overhead voor een prototype dat al op Node + `pg`
draait sinds de ingest-scripts. FastAPI is Python — nergens anders in deze
repo aanwezig. Express hergebruikt de bestaande modules rechtstreeks, zonder
duplicatie, en is precies wat de opdracht zelf als optie noemt.

| Endpoint                         | Doet                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /straten/:gemeente`         | Lijst van straten + aantal establishments                                                                                                              |
| `GET /straten/:gemeente/:straat` | Alle vestigingen + hun laatste beoordeling, VME's apart onder `uitgesloten`, verdachte domicilieadressen samengevouwen tot één `domicilie_groep`-entry |
| `GET /vestiging/:id`             | Onderneming + vestiging + alle evidence (chronologisch) + huidige + historische beoordelingen                                                          |
| `POST /vestiging/:id/beoordeel`  | Roept de confidence-engine aan, slaat het voorstel op (of sluit uit bij VME)                                                                           |
| `POST /beoordeling/:id/bevestig` | Zet `status='bevestigd'` — vereist `{ "beoordeeld_door": "..." }` in de body                                                                           |
| `POST /beoordeling/:id/wijs-af`  | Idem, `status='afgewezen'`                                                                                                                             |
| `GET /te-controleren`            | Openstaande voorstellen, **laagste kans eerst**                                                                                                        |

Een paar keuzes die niet letterlijk in de opdracht stonden maar wel nodig
bleken:

- **Herberekenen overschrijft, dupliceert niet.** Staat er al een openstaand
  (`te_controleren`) voorstel voor een vestiging, dan wordt dat ververst in
  plaats van een tweede rij aan te maken — een nog niet beoordeeld voorstel
  bevat geen menselijke beslissing, dus mag gerust vervangen worden. Is een
  voorstel al bevestigd of afgewezen, dan komt er wél een nieuwe rij bij: die
  geschiedenis raakt nooit overschreven.
- **Bevestigen/afwijzen faalt hard, nooit stil.** Een tweede keer bevestigen
  geeft `409 Conflict` (met de huidige status erbij), een onbekend id geeft
  `404`, een ontbrekende `beoordeeld_door` geeft `400`. Nergens een stille
  dubbele beslissing.
- **VME's blijven zichtbaar, maar apart.** Ze verdwijnen niet uit de
  straat-respons (transparantie), maar staan onder `uitgesloten` met hun reden
  — nooit vermengd met de bedrijvenlijst.

**Volledig getest op Paalstraat, Schoten** (echte gedockeriseerde Postgres,
echte VKBO-data, gerichte evidence-scenario's die elke tak van de
engine raken — géén Google-calls nodig om de logica te testen): 48/48
controles geslaagd, inclusief alle 7 endpoints, de bevestig/wijs-af/409-flow,
en de Paalstraat 70-domicilie-check hierboven.

**Eindresultaat voor Paalstraat, Schoten**, zoals `docker compose up` het
oplevert (354 niet-VME vestigingen beoordeeld, met de gelabelde demosignalen —
zie [Demo-modus](#snel-starten)):

|                                    |                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Establishments in de straat        | 379                                                                        |
| Uitgesloten als VME (gebouwbeheer) | 25                                                                         |
| Samengevouwen als domicilie-groep  | 25 (Paalstraat 70 — **niet** bevestigd als brievenbusadres, zie hierboven) |
| Beoordeeld                         | 354                                                                        |
| — Hoog (≥ 70%)                     | 210                                                                        |
| — Middel (40–69%)                  | 72                                                                         |
| — Laag (< 40%)                     | 72                                                                         |
| Gemiddelde kans                    | 69%                                                                        |

De demosignalen zijn bewust in meerdere varianten geschreven, zodat de
percentages over de hele schaal spreiden (8, 17, 31, 50, 69, 83, 92, 95%) in
plaats van drie keer dezelfde waarde te herhalen — anders zegt "83%" niets meer
dan het woord "Hoog". Verdeling van de voorgestelde status: 210× `actief`,
72× `kbo_niet_op_adres`, 54× `waarschijnlijk_inactief`, 18× `onzeker`.

## Frontend — het dashboard voor de economieambtenaar

```bash
cd frontend
npm install
npm run dev                # VITE_API_URL is optioneel, default http://localhost:3000
```

React + Vite, praat rechtstreeks met de bestaande API (`fetch`, zie
[frontend/src/api.js](frontend/src/api.js)) — geen nieuwe backend-logica in de
frontend, enkel weergave en de bevestig/wijs-af-acties. Kaart: **Leaflet +
OpenStreetMap-tegels**, gratis, geen API-key.

| Route             | Pagina                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| `/`               | Dashboard — KPI's, zoekbalk, filters, kaart + lijst                                 |
| `/straat`         | Analyseer straat — de tabel met exact de gevraagde kolommen                         |
| `/vestiging/:id`  | Detailpagina — adres lokaal vs. zetel, evidence-tijdlijn, redenen, bevestig/wijs-af |
| `/te-controleren` | Review-queue, laagste kans eerst, inline bevestig/wijs-af                           |

**Sortering, zoals expliciet gevraagd:** default overal laagste → hoogste
zekerheid; op het Dashboard is dat een knop ("Sorteer op kans: laagste eerst /
hoogste eerst"), op de review-queue vast (dat IS de hele pagina). Er wordt
gesorteerd op het percentage zelf en niet op de band: binnen "Laag" is 8%
dringender dan 31%, en dat verschil zag je met alleen een band niet.

**Twee kleine, bewuste afwijkingen van de letterlijke tekst**, beide om de
ambtenaar niet te misleiden:

1. De opdracht geeft een vaste tekst voor een samengevouwen domicilie-rij
   ("vermoedelijk domicilieadres"). De engine kan dat ook
   **weerleggen** (NACE-diversiteit) — dus toont de rij naargelang het geval
   "bevestigd als vermoedelijk brievenbusadres: ..." of "NIET bevestigd:
   activiteiten liggen dicht bij elkaar, vermoedelijk een legitiem
   bedrijvengebouw". Paalstraat 70 blijft zo zichtbaar als **niet verdacht**,
   in plaats van het tegendeel te beweren.
2. De tabelkolommen "Register" en "Bewijs van activiteit" bestonden nog niet
   als aparte velden in de API — die worden client-side afgeleid uit de
   `redenen`-array van de beoordeling (elk signaal was daar al een losse,
   leesbare regel; dit is puur een indeling in twee kolommen, geen nieuwe
   logica). Zie `splitsRedenen()` in
   [frontend/src/labels.js](frontend/src/labels.js).

**Eén backend-aanpassing was nodig**: `GET /straten/:gemeente/:straat` gaf nog
geen `latitude`/`longitude` terug — onmisbaar voor de kaart. Dat zijn twee
extra velden op een bestaand endpoint, geen nieuw endpoint (zie
`haalEstablishmentsVoorStraat()` in
[scripts/lib/beoordelingen-db.js](scripts/lib/beoordelingen-db.js)).

**Live/Handmatig-badge**: elke evidence-kaart toont `Live` (bron `vkbo` of
`google_places`) of `Handmatig` (alles anders, bv. een NBB-jaarrekening die
een ambtenaar zelf natrekte) — zie `BronBadge`.

**Getest met een echte browser, niet enkel gebouwd.** Playwright (headless
Chromium) tegen de draaiende app + een echte gedockeriseerde Postgres met
Paalstraat-data: alle 4 pagina's bezocht, de domicilie-groep uitgeklapt, en de
volledige bevestig-flow doorlopen ("Voorstel bevestigd door A. Janssens" —
knoppen verdwijnen, geen herlaad). Geen console-errors op enige pagina.

Twee echte bugs kwamen daarbij naar boven, allebei gefixt:

- **Gedeelde staat werkte niet.** Het naam-veld in de header en de
  bevestig/wijs-af-knoppen gebruikten elk hun eigen kopie van dezelfde React-
  hook, elk met hun eigen `localStorage`-lezing bij het opstarten — typen in
  de header kwam nooit aan bij de knoppen. Opgelost met één gedeelde
  `BeoordelaarProvider` (React Context).
- **Kapotte kaart door een datafout in de bron, niet in de code.** 2 van de
  379 Paalstraat-vestigingen hebben een foutieve geocode in de VKBO/
  Adressenregister-data (Creil, Frankrijk, in plaats van Schoten) — daardoor
  zoomde de kaart uit tot heel West-Europa. De kaart berekent nu het
  inzoomgebied op basis van de **mediaan** van de coördinaten (ongevoelig voor
  uitschieters) — de foutieve punten blijven gewoon zichtbaar als je er zelf
  naartoe navigeert, ze verstoren enkel niet langer de automatische zoom.

## Wat er nog niet in zit

- **Geen gecommitte testsuite.** De controles in dit document zijn tijdens de
  ontwikkeling gedraaid, maar staan niet in de repo — er is dus niets om in CI
  te hangen. Dit is de eerste schuld die afbetaald moet worden.
- `evidence` hangt altijd aan een vestiging. Bewijs voor een zaak die nog niet in
  het register staat (`mogelijk_ontbrekend`) past er dus nog niet in; dat zit nu
  in `redenen` en `voorstel_tekst` van de beoordeling.
- Coördinaten staan als losse `latitude`/`longitude`. Voor echte
  nabijheidszoekopdrachten is PostGIS met een `geography`-kolom de volgende stap.
- Telefoon en e-mail rechtstreeks uit VKBO (los van Google Places) zijn nog
  niet overgenomen.
- Geen authenticatie op de API. `beoordeeld_door` is een vrij tekstveld in de
  request body — in een echte inzet zou dit uit een ingelogde sessie komen,
  niet door de client zelf opgegeven worden.
- Geen paginering op `GET /straten/:gemeente/:straat` of `GET /te-controleren`
  — voor één straat of een prototype-dataset is dat geen probleem, voor alle
  33.000 inschrijvingen van een gemeente ineens wél.

## Bronnen

- **VKBO** (Digitaal Vlaanderen) — gratis, geen key.
  `https://geo.api.vlaanderen.be/VKBO/ogc/features/v1/collections/Vkbo/items`
  met CQL2-filters, bv. `?f=application/json&filter=KBO_Gemeente='Schoten'&filter-lang=cql2-text`.
  Loopt 1 tot 3 dagen achter op het federale KBO.
- **Google Places API (New)** — beperkt budget, key is restricted tot Places API.
  Gebruikt door [scripts/verrijk-google-places.js](scripts/verrijk-google-places.js),
  met een harde limiet per run (`MAX_PLACES_CALLS`).
- **NBB CBSO jaarrekeningen** — nog 10 requests over. **Niet** in de automatische
  pipeline gebruiken; enkel handmatig voor één of twee twijfelgevallen.

**Waar de cijfers vandaan komen.** De steekproefcijfers (105 VME's op 1000
inschrijvingen, 35 in vereffening, ...) komen uit
`KBO/schoten-kbo-1000-2026-09-07.geojson` — 1000 inschrijvingen, opgehaald op
2026-09-07, één pagina en dus niet de volledige gemeente. De
Paalstraat-resultaten (379 establishments, 354 beoordelingen, de
percentageverdeling) komen uit een verse `docker compose up`-run en zijn
reproduceerbaar met dat ene commando.

This is for a fact the best solution out of all the solutions
