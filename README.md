# Bedrijvenradar — PROV-AI Challenge 1 · Find the Real Businesses

MVP voor medewerkers lokale economie: **zoek een zaak (naam / adres / ondernemingsnummer) → controleer activiteit via meerdere bronnen → activiteitsscore met uitleg → bevestigen/afwijzen**.
De medewerker neemt altijd de eindbeslissing; enkel bevestigde voorstellen verlaten de tool (`approved_changes`).

## Snel starten (lokaal, Windows/macOS/Linux)

Vereist: Node 20+, Docker Desktop (aan).

```bash
npm install                      # root: Supabase CLI, tsx
npm --prefix web install         # frontend
npm run db:start                 # lokale Supabase in Docker (+ migraties)
npx supabase status -o env       # kopieer API_URL / SERVICE_ROLE_KEY / ANON_KEY (zie hieronder)
```

1. `.env` (root) — kopieer `.env.example`, vul `KBO_API_TOKEN`, `GOOGLE_PLACES_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `web/.env.local` — kopieer `web/.env.example`, vul `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` (publieke key).

```bash
npm run functions                # Edge Functions lokaal (apart terminalvenster)
npm run web                      # http://localhost:5173
```

Zoeken haalt records live uit de VKBO; bulkimport is optioneel: `npm run import:street` (Paalstraat) of `npm run import:sample` laadt het 1.000-records-starterbestand (`KBO/*.geojson`). Supabase Studio: http://127.0.0.1:54323

## Architectuur

```
web/ (React + Vite + TS + Tailwind)          ── enkel publieke anon key
  SearchPage → RecordDetail (+ ReviewPanel, EvidenceList, UsageBar)
        │ supabase-js: lezen + officer_reviews invoegen · functions.invoke
supabase/functions/ (Deno Edge Functions)    ── geheime keys enkel hier
  search           zoekt in VKBO op naam/adres/nummer binnen gekozen gemeente (gratis); nummer niet gevonden → KBO API
  check-activity   KBO API → jaarrekening.be → (Google Places via knop) → websitecheck → activiteitsscore
  enrich-kbo / enrich-google / enrich-accounts / analyze   losse stappen (zelfde modules)
  _shared/         vkbo.ts, sources.ts (alle bronnen), rules.ts (rules-v2), analysis.ts, normalize.ts, http.ts
supabase/migrations/  schema, views, RLS, API-quotum (dag + maand)
scripts/import-vkbo.ts  optionele bulkimport (gebruikt _shared/vkbo.ts)
```

### Datamodel (kern)

| Tabel | Inhoud |
|---|---|
| `municipalities` | NIS-code, naam, postcodes |
| `enterprises` | Juridische entiteit. Status staat hier. `completeness = number_only` = moeder enkel als nummer bekend (vaak eenmanszaak, niet in VKBO) |
| `establishments` | Fysieke vestiging, gekoppeld via `enterprise_number`. KBO- én adressenregister-adres, `geo_quality` |
| `evidence` | Eén observatie uit één bron: `source`, `source_record_id`, `summary_nl`, `value`, `url`, `observed_at`, `retrieved_at`, `match_quality` |
| `analysis` | Voorstel: `proposed_status`, `confidence` (HIGH/MEDIUM/LOW), `reasons[]` met `evidence_ids`, `model_version`. Oude voorstellen blijven bewaard |
| `officer_reviews` | Append-only: `decision` (confirmed/rejected), optionele `final_status`, `comment`, `reviewer` (naamveld) |
| `api_usage` | Harde daglimiet per externe API (`consume_api_quota`, niet aanroepbaar vanuit frontend) |

Views: `street_records` (vestigingen + zetels per straat met laatste voorstel/beslissing), `approved_changes` (enkel bevestigd).

Brondata wordt nooit gewijzigd: de oorspronkelijke rij staat in `raw`; genormaliseerde velden staan ernaast.
Ondernemings- en vestigingsnummers zijn **tekst** (`CHECK ~ '^\d{10}$'`).

### Activiteitsmodel rules-v2

**Score 0–100** = hoe sterk het bewijs wijst op een actieve zaak. Start op 50 (geen informatie), elke regel telt punten op of af.
Label: ≥80 Actief · 60–79 Waarschijnlijk actief · 41–59 Onzeker · 21–40 Waarschijnlijk inactief · ≤20 Inactief.
**Zekerheid** (HIGH/MEDIUM/LOW) = hoeveel onafhankelijke, sterke en eensgezinde bronnen er zijn; conflict of onbekende onderneming → LOW.
De score is **geen gekalibreerde kans**; kalibratie vraagt validatie met door medewerkers gecontroleerde zaken.

| Bron | Regel | Punten |
|---|---|---|
| Register | faillissement / ontbonden · vereffening · reorganisatie · normaal | −40 · −35 · −10 · +5 |
| KBO API | status niet actief | −40 |
| Register | ambtshalve doorhaling (jaarrekening / andere) · vestiging of adres doorgehaald | −25 / −15 · −25 |
| Register | gestart minder dan 2 jaar geleden | +5 |
| Google Places | open (exact / waarschijnlijke match) · tijdelijk gesloten · definitief gesloten (exact / waarschijnlijk) | +30 / +20 · −10 · −45 / −35 |
| Google Places | openingsuren · ≥10 beoordelingen · geen vermelding · onzekere match | +5 · +3 · −5 · 0 |
| Jaarrekening.be | einddatum · laatste boekjaar ≤2 jaar oud · 3 jaar · ouder · geen (rechtspersoon) · werknemers | −40 · +15 · 0 · −20 · −10 · +5 |
| Staatsblad | publicatie over ontbinding/faillissement (<3 j) · recente publicatie (<2 j) | −20 · +5 |
| Website | bereikbaar (+ vermeldt gemeente) · sluitingssignaal · domein bestaat niet · technische fout | +4 (+8) · −10 · −8 · 0 |

Conflict (bv. register failliet + Google open) → voorstel "Conflict — manuele controle", zekerheid LOW.
Google-matchkwaliteit: **exact** = straat + huisnummer gelijk én naam ≥ 80 % gelijk; **probable** = adres gelijk + naam ≥ 50 %, of naam ≥ 80 % + zelfde straat of ≤ 75 m; anders **uncertain** (getoond, niet meegeteld).

### Kosten (gratis houden)

- Google Places enkel via knop (`GOOGLE_AUTO_ON_OPEN=false`), cache 7 dagen, harde limiet 10/dag en 900/maand (gratis volume Enterprise-SKU = 1.000/maand).
- KBO API: 200/dag, 5.000/maand (gratis plan 2.500/dag). Jaarrekening.be: 60/dag, 190/maand, cache 30 dagen, na fout 6 uur pauze.
- Verbruik staat rechtsboven in de app.

### Wanneer bronnen verschillen

Geen bron wint automatisch; verschillen worden getoond en de medewerker beslist. Leidend per soort gegeven:
juridische status → KBO · fysieke activiteit → terreinbezoek > Google (recent) > register · adres → KBO tonen, adressenregister ernaast ·
coördinaat → VKBO tenzij placeholder · contact → per bron, met niveau (vestiging/zetel) · jaarrekening → enkel ondernemingsniveau.

## Security

- Geen API-keys in frontendcode; frontend kent enkel de publieke anon key.
- `KBO_API_TOKEN`, `GOOGLE_PLACES_API_KEY`, `JAARREKENING_API_TOKEN` enkel in Edge Functions (server-side env).
- RLS: anon mag lezen en reviews toevoegen; geen update/delete op reviews; register/evidence/analysis enkel via service role.
- `.env*` staat in `.gitignore` (behalve `.env.example`).
- Kostenbeveiliging: Google max `GOOGLE_PLACES_DAILY_LIMIT` (standaard 10) requests/dag + 7 dagen cache; KBO API max `KBO_API_DAILY_LIMIT`.

## Bekende beperkingen

- Zoeken binnen de gekozen gemeente (VKBO = Vlaanderen); geen kaart of dashboard.
- VKBO bevat geen ondernemingen van natuurlijke personen → moeder eerst als nummer, aanvullen via "KBO-gegevens ophalen".
- 36 records in het starterbestand hebben een nep-coördinaat (49.2933, 2.3067); die worden als `placeholder` gemarkeerd.
- Google Places is bewijs, geen waarheid; maximaal 3 kandidaten per zoekopdracht; recensiedatums worden (nog) niet opgehaald.
- Jaarrekening.be: koppeling actief, maar het huidige account antwoordt "API request limit reached" (plan/limiet van het account).
- Geen login: reviewer is een naamveld.

Wijzigingen aan env-variabelen: zie [docs/ENV_CHANGES.md](docs/ENV_CHANGES.md).

Bronvermelding: publieke KBO gegevens, verrijkt met adressen uit het Vlaamse Adressenregister (VKBO, Modellicentie Gratis Hergebruik v1.0).
