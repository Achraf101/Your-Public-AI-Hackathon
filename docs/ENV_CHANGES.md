# Wijzigingen environment variables

## 2026-09-16 — hernoemd en aangevuld (goedgekeurd door team)

Waarden zijn niet gewijzigd, enkel namen. Spaties vóór `=` zijn verwijderd (die braken het inlezen).

| Oud (in `.env`) | Nieuw | Gebruikt door |
|---|---|---|
| `CBEAPI ` | `KBO_API_TOKEN` | Edge Function `enrich-kbo` |
| `GOOGLE_PLACES ` | `GOOGLE_PLACES_API_KEY` | Edge Function `enrich-google` |
| `# JAARREKENING_API_TOKEN` | ongewijzigd (blijft uitgeschakeld) | Edge Function `enrich-accounts` (nog niet actief) |

Nieuw toegevoegd:

| Variabele | Bestand | Doel |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `.env` | Importscript (lokale Supabase). Worden door `supabase functions serve` bewust overgeslagen; de Edge Runtime zet ze zelf. |
| `GOOGLE_PLACES_DAILY_LIMIT=10` | `.env` | Harde daglimiet Google Places |
| `KBO_API_DAILY_LIMIT=200` | `.env` | Harde daglimiet KBO API |
| `JAARREKENING_ENABLED=false` | `.env` | Jaarrekening-koppeling aan/uit |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `web/.env.local` | Frontend (publieke anon key, geen geheim) |

Optioneel: `GOOGLE_PLACES_CACHE_DAYS` (7), `KBO_API_BASE_URL` (`https://cbeapi.be/api`), `JAARREKENING_API_BASE_URL`, `JAARREKENING_DAILY_LIMIT` (50).

`.gitignore` aangepast: `.env*` blijft genegeerd, maar `.env.example` mag in git (sjabloon zonder waarden).

## 2026-09-16 (namiddag) — MVP v2: zoeken + activiteitsscore

| Variabele | Waarde | Doel |
|---|---|---|
| `JAARREKENING_API_TOKEN` | uit commentaar gehaald | jaarrekening.be API |
| `JAARREKENING_ENABLED` | `true` | koppeling actief |
| `GOOGLE_PLACES_MONTHLY_LIMIT` | `900` | harde maandlimiet (onder gratis volume) |
| `GOOGLE_AUTO_ON_OPEN` | `false` | Google enkel via knop; later `true` = automatisch bij openen |
| `KBO_API_MONTHLY_LIMIT` | `5000` | harde maandlimiet |
| `JAARREKENING_DAILY_LIMIT` / `JAARREKENING_MONTHLY_LIMIT` | `60` / `190` | limieten (3 requests per onderneming) |

Optioneel: `JAARREKENING_CACHE_DAYS` (30), `JAARREKENING_API_BASE_URL` (`https://jaarrekening.be/api/v1`).
