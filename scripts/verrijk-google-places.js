#!/usr/bin/env node
// ============================================================================
// Verrijkt de vestigingen van één straat met publiek bewijs uit Google Places
// (New) — enkel evidence, nooit een automatisch voorstel. STRIKTE
// kostenbeheersing staat centraal, niet als bijzaak:
//
//   1. FieldMask zo krap mogelijk, per call (zie places-api.js).
//   2. Harde bovengrens op het AANTAL requests per run (MAX_PLACES_CALLS,
//      default 50) — geteld vóór elke poging, dus ook een mislukte call telt
//      mee. De run stopt zodra de grens bereikt is, ook halverwege een
//      vestiging.
//   3. Cache: een vestiging met al evidence van bron google_places van
//      VANDAAG wordt overgeslagen. Een herstart na een crash of een tweede
//      keer draaien op dezelfde dag kost dus geen extra requests.
//   4. Nooit gokken: bij 0 of meerdere zoekresultaten, of een resultaat dat
//      niet overtuigend overeenkomt, wordt dat opgeslagen als
//      evidence type='geen_match_gevonden' — nooit het eerste resultaat
//      blind aangenomen. Zie places-match.js.
//
// Gebruik:
//   node --env-file=.env scripts/verrijk-google-places.js <Gemeente> <Straat>
//   npm run verrijk -- Schoten Paalstraat
//
// Env: GOOGLE_PLACES (API-key, verplicht), DATABASE_URL (verplicht),
//      MAX_PLACES_CALLS (optioneel, default 50).
// ============================================================================

import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { haalVestigingenVoorStraat, schrijfMatchEvidence, schrijfGeenMatchEvidence } from './lib/places-db.js'
import { zoekPlaats, haalDetails } from './lib/places-api.js'
import { kiesBesteMatch } from './lib/places-match.js'

const STANDAARD_LIMIET = 50

/**
 * Verwerkt alle vestigingen van één straat, met een harde bovengrens van
 * maxRequests Places-requests over de hele run heen (Text Search + Place
 * Details tellen allebei mee). Elke DB-schrijving gebeurt per vestiging in
 * haar eigen transactie (zie places-db.js): een crash of het bereiken van de
 * limiet halverwege mag nooit de evidence van eerder verwerkte — en dus al
 * betaalde — vestigingen ongedaan maken.
 *
 * @param {object} opties
 * @param {string} opties.gemeente
 * @param {string} opties.straat
 * @param {{query: Function}} opties.db - EEN uitgecheckte connectie, geen Pool.
 * @param {string} opties.apiKey
 * @param {number} [opties.maxRequests]
 * @param {(regel: string) => void} [opties.log] - injecteerbaar voor tests.
 * @param {{zoekPlaats: Function, haalDetails: Function}} [opties.placesClient] - injecteerbaar voor tests.
 */
export async function verrijkStraat ({
  gemeente,
  straat,
  db,
  apiKey,
  maxRequests = STANDAARD_LIMIET,
  log = console.log,
  placesClient = { zoekPlaats, haalDetails }
}) {
  const vestigingen = await haalVestigingenVoorStraat(db, { gemeente, straat })

  const rapport = {
    totaalVestigingen: vestigingen.length,
    verwerkt: 0,
    matches: 0,
    geenMatch: 0,
    overgeslagenCache: 0,
    overgeslagenGeenNaam: 0,
    nietVerwerktDoorLimiet: 0,
    requestsGebruikt: 0,
    limietBereikt: false
  }

  /** Telt een request VÓÓR de poging, dus ook een mislukte call telt mee. */
  function magNogEenRequest () {
    if (rapport.requestsGebruikt >= maxRequests) {
      if (!rapport.limietBereikt) {
        log(`LIMIET BEREIKT: ${maxRequests} Places-requests verbruikt (MAX_PLACES_CALLS). Stop met verwerken.`)
      }
      rapport.limietBereikt = true
      return false
    }
    rapport.requestsGebruikt++
    return true
  }

  let teller = 0
  for (const v of vestigingen) {
    teller++
    const label = `[${teller}/${vestigingen.length}] ${v.vestiging_id} (${v.straat ?? '?'} ${v.huisnr ?? ''})`.trim()

    if (v.al_vandaag_opgehaald) {
      rapport.overgeslagenCache++
      log(`${label} -> overgeslagen: al vandaag opgehaald`)
      continue
    }
    if (!v.zoeknaam) {
      rapport.overgeslagenGeenNaam++
      log(`${label} -> overgeslagen: geen naam bekend (moederonderneming nog niet verrijkt)`)
      continue
    }
    if (rapport.limietBereikt || !magNogEenRequest()) {
      rapport.nietVerwerktDoorLimiet++
      continue
    }

    const zoekterm = `${v.zoeknaam}, ${[v.straat, v.huisnr].filter(Boolean).join(' ')}, ${[v.postcode, v.gemeente].filter(Boolean).join(' ')}`

    let resultaten
    try {
      resultaten = await placesClient.zoekPlaats({ zoekterm, apiKey })
    } catch (fout) {
      log(`${label} -> FOUT bij Text Search: ${fout.message}`)
      continue
    }

    const { plaats, reden } = kiesBesteMatch(resultaten, { zoeknaam: v.zoeknaam, postcode: v.postcode })

    if (!plaats) {
      await schrijfGeenMatchEvidence(db, {
        establishmentId: v.vestiging_id,
        reden,
        ruwePayload: { zoekterm, kandidaten: resultaten }
      })
      rapport.geenMatch++
      rapport.verwerkt++
      log(`${label} -> geen match (${reden})`)
      continue
    }

    if (!magNogEenRequest()) {
      rapport.nietVerwerktDoorLimiet++
      log(`${label} -> match gevonden, maar limiet bereikt vóór Place Details. Wordt bij een volgende run opnieuw geprobeerd.`)
      continue
    }

    let details
    try {
      details = await placesClient.haalDetails({ placeId: plaats.id, apiKey })
    } catch (fout) {
      log(`${label} -> FOUT bij Place Details: ${fout.message}`)
      continue
    }

    const aantalRijen = await schrijfMatchEvidence(db, {
      establishmentId: v.vestiging_id,
      details,
      bronUrl: details.googleMapsUri ?? null
    })
    rapport.matches++
    rapport.verwerkt++
    log(`${label} -> match: "${details.displayName?.text ?? plaats.displayName?.text}" (${aantalRijen} evidence-rijen)`)
  }

  return rapport
}

// ---------------------------------------------------------------- CLI -----
async function main () {
  const [gemeente, straat] = process.argv.slice(2)
  if (!gemeente || !straat) {
    console.error('Gebruik: node scripts/verrijk-google-places.js <Gemeente> <Straat>')
    console.error('Bijvoorbeeld: node scripts/verrijk-google-places.js Schoten Paalstraat')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ontbreekt. Zie .env.example en draai met --env-file=.env.')
    process.exit(1)
  }
  if (!process.env.GOOGLE_PLACES) {
    console.error('GOOGLE_PLACES (API-key) ontbreekt. Zie .env.example en draai met --env-file=.env.')
    process.exit(1)
  }

  const maxRequests = Number(process.env.MAX_PLACES_CALLS ?? STANDAARD_LIMIET)
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    console.error(`MAX_PLACES_CALLS moet een positief getal zijn, kreeg: ${process.env.MAX_PLACES_CALLS}`)
    process.exit(1)
  }

  const gebruiktSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && process.env.PGSSLMODE !== 'disable'
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: gebruiktSSL ? { rejectUnauthorized: false } : undefined
  })

  const client = await pool.connect()
  try {
    console.log(`Google Places-verrijking voor ${gemeente} / ${straat} (limiet: ${maxRequests} requests) ...\n`)
    const rapport = await verrijkStraat({ gemeente, straat, db: client, apiKey: process.env.GOOGLE_PLACES, maxRequests })

    console.log('')
    console.log(`Vestigingen in deze straat:          ${rapport.totaalVestigingen}`)
    console.log(`Verwerkt:                             ${rapport.verwerkt}`)
    console.log(`  - matches:                          ${rapport.matches}`)
    console.log(`  - geen match:                       ${rapport.geenMatch}`)
    console.log(`Overgeslagen (al vandaag opgehaald):  ${rapport.overgeslagenCache}`)
    console.log(`Overgeslagen (geen naam bekend):      ${rapport.overgeslagenGeenNaam}`)
    console.log(`Niet verwerkt door limiet:             ${rapport.nietVerwerktDoorLimiet}`)
    console.log(`Places-requests verbruikt:             ${rapport.requestsGebruikt} / ${maxRequests}`)
    if (rapport.limietBereikt) {
      console.log('\nLET OP: de limiet werd bereikt. Draai het script opnieuw om de rest van de straat te')
      console.log('verwerken — reeds verwerkte vestigingen worden dankzij de cache niet dubbel opgehaald.')
    }
  } finally {
    client.release()
    await pool.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((fout) => {
    console.error('Verrijking mislukt:', fout.message)
    process.exit(1)
  })
}
