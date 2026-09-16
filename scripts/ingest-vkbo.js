#!/usr/bin/env node
// ============================================================================
// Ingest: VKBO live API -> Supabase (enterprises + establishments).
// ----------------------------------------------------------------------------
// Gebruik (CLI):
//   node --env-file=.env scripts/ingest-vkbo.js <Gemeente> [Straat]
//   npm run ingest -- Schoten Paalstraat
//
// Waarom Node.js i.p.v. Python: dit script bouwt rechtstreeks verder op de
// SQL-migraties (dezelfde repo, dezelfde GENERATED kolommen en triggers) en
// leunt op de ingebouwde fetch() (Node 20+) en --env-file (Node 20+) — geen
// enkele extra dependency nodig behalve de Postgres-driver zelf (`pg`).
// Belangrijker: de databaselaag (database.js) is geschreven tegen een
// generieke {query(sql, params)}-interface, waardoor exact dezelfde code
// tijdens het testen tegen een in-process Postgres-engine (PGlite) kon
// draaien en tegen echte Supabase in productie — zonder mocks. Dat gaf de
// zekerheid dat de upserts, de FK-afhankelijkheid (onderneming vóór
// vestiging) en de domicilie-herberekening precies doen wat de migraties
// afdwingen.
//
// Waarom geen Supabase JS-client: die praat met de database via PostgREST
// (de anon/service-role HTTP-laag) en dat botst met de RLS-policies uit
// 20260916120500_rls.sql, die bewust GEEN insert/update op enterprises en
// establishments toestaan aan authenticated/anon — enkel service_role via
// een rechtstreekse Postgres-connectie mag hier schrijven. Vandaar `pg` met
// DATABASE_URL, niet de Supabase-client met een API-key.
// ============================================================================

import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { haalAlleFeatures } from './lib/vkbo-api.js'
import { tekst, datumDeel, classificeer } from './lib/normalize.js'
import {
  zorgVoorOnderneming,
  upsertOnderneming,
  upsertVestiging,
  herberekenDomicilieVerdacht,
  telDomicilieVerdacht
} from './lib/database.js'

/** Zet één GeoJSON-feature om in de velden die upsertVestiging verwacht. */
function naarVestigingRij (feature, { id, enterpriseId, isZetel }) {
  const p = feature.properties
  const coords = feature.geometry?.coordinates ?? null
  return {
    id,
    enterpriseId,
    isZetel,
    straat: tekst(p.KBO_Straat),
    huisnr: tekst(p.KBO_Huisnr),
    postcode: tekst(p.KBO_Postcode),
    gemeente: tekst(p.KBO_Gemeente),
    arStraat: tekst(p.AR_straat),
    arHuisnr: tekst(p.AR_huisnr),
    arPostcode: tekst(p.AR_postcode),
    // Zie migratie 20260916130000_nace.sql: dit veld staat soms rechtstreeks
    // op de vestigingsrij (spaarzaam ingevuld), niet enkel op de onderneming.
    naceCodeRsz: tekst(p.NACE_hoofdact_RSZ),
    naceOmschrijvingRsz: tekst(p.Omschrijving_hoofdact_RSZ),
    // GeoJSON-volgorde is [lengtegraad, breedtegraad] (EPSG:4326).
    longitude: coords ? coords[0] : null,
    latitude: coords ? coords[1] : null
  }
}

/**
 * Haalt één gemeente (+ optioneel straat) op uit de VKBO-API en schrijft ze
 * weg naar enterprises/establishments. Idempotent: alles gebeurt via
 * upsert (ON CONFLICT (id) DO UPDATE), dus opnieuw draaien voor dezelfde
 * straat maakt geen duplicaten en werkt bestaande rijen gewoon bij.
 *
 * @param {object} opties
 * @param {string} opties.gemeente
 * @param {string} [opties.straat]
 * @param {{query: Function}} opties.db - EEN uitgecheckte connectie, geen Pool
 *   (zie het transactie-commentaar in database.js).
 * @param {typeof fetch} [opties.fetchImpl] - injecteerbaar voor tests.
 */
export async function ingestStraat ({ gemeente, straat, db, fetchImpl = fetch }) {
  const features = await haalAlleFeatures({ gemeente, straat, fetchImpl })

  // Fase 1: alle ondernemingsrijen eerst. Zo staat de rechtsvorm al vast
  // vóórdat we hun vestigingen (fase 2) inlezen, en hoeft de is_vme-trigger
  // niet nog een keer te corrigeren binnen dezelfde run.
  const ondernemingFeatures = []
  const vestigingFeatures = []
  for (const f of features) {
    if (classificeer(f.properties) === 'enterprise') ondernemingFeatures.push(f)
    else vestigingFeatures.push(f)
  }

  await db.query('BEGIN')
  try {
    let ondernemingenIngeladen = 0
    let zetelsIngeladen = 0
    const vestigingResultaten = []

    for (const f of ondernemingFeatures) {
      const p = f.properties
      const id = tekst(p.Ondernemingsnr)
      if (!id) continue // zonder ondernemingsnummer is er niets om aan te koppelen

      await upsertOnderneming(db, {
        id,
        naam: tekst(p.Maatschappelijke_naam),
        handelsnaam: tekst(p.Commerciele_naam),
        rechtsvorm: tekst(p.Rechtsvorm),
        rechtstoestand: tekst(p.Rechtstoestand),
        datumStopzetting: datumDeel(p.Datum_stopzetting),
        naceCodeBtw: tekst(p.NACE_hoofdact_BTW),
        naceOmschrijvingBtw: tekst(p.Omschrijving_hoofdact_BTW)
      })
      ondernemingenIngeladen++

      // Elke onderneming krijgt ook een rij in establishments voor haar
      // eigen zetel — anders gaat het zeteladres nergens verloren en kun je
      // "zetel elders" niet van "vestiging hier" onderscheiden (zie README).
      const zetel = await upsertVestiging(db, naarVestigingRij(f, { id, enterpriseId: id, isZetel: true }))
      vestigingResultaten.push(zetel)
      zetelsIngeladen++
    }

    let placeholdersAangemaakt = 0
    for (const f of vestigingFeatures) {
      const p = f.properties
      const id = tekst(p.Ondernemingsnr)
      const enterpriseId = tekst(p.Ondernemingsnr_maatsch_zetel)
      if (!id || !enterpriseId) continue

      // De moederonderneming ligt vaak buiten de opgehaalde gemeente/straat
      // (in de Schoten-steekproef ontbrak ze bij 515 van de 543 vestigingen).
      // Zonder deze stap zou de foreign key de vestiging gewoon weigeren.
      const nieuw = await zorgVoorOnderneming(db, enterpriseId)
      if (nieuw) placeholdersAangemaakt++

      const resultaat = await upsertVestiging(db, naarVestigingRij(f, { id, enterpriseId, isZetel: false }))
      vestigingResultaten.push(resultaat)
    }

    // Domicilie-heuristiek: pas NA het inladen van de hele straat, zodat de
    // telling per (straat, huisnr) klopt voor de volledige, net bijgewerkte set.
    await herberekenDomicilieVerdacht(db, { gemeente, straat })
    const domicilieVerdachtTotaal = straat ? await telDomicilieVerdacht(db, { gemeente, straat }) : null

    await db.query('COMMIT')

    return {
      opgehaald: features.length,
      ondernemingenIngeladen,
      vestigingenIngeladen: vestigingResultaten.length,
      zetelsIngeladen,
      placeholdersAangemaakt,
      adresNietGevalideerd: vestigingResultaten.filter((r) => !r.adres_gevalideerd).length,
      domicilieVerdachtTotaal
    }
  } catch (fout) {
    await db.query('ROLLBACK')
    throw fout
  }
}

// ---------------------------------------------------------------- CLI -----
async function main () {
  const [gemeente, straat] = process.argv.slice(2)
  if (!gemeente) {
    console.error('Gebruik: node scripts/ingest-vkbo.js <Gemeente> [Straat]')
    console.error('Bijvoorbeeld: node scripts/ingest-vkbo.js Schoten Paalstraat')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ontbreekt. Zie .env.example en draai met --env-file=.env.')
    process.exit(1)
  }

  const gebruiktSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && process.env.PGSSLMODE !== 'disable'
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: gebruiktSSL ? { rejectUnauthorized: false } : undefined
  })

  // Eén uitgecheckte connectie, geen Pool zelf: nodig voor BEGIN/COMMIT.
  const client = await pool.connect()
  try {
    console.log(`VKBO ophalen voor ${gemeente}${straat ? ' / ' + straat : ''} ...`)
    const rapport = await ingestStraat({ gemeente, straat, db: client })

    console.log('')
    console.log(`Opgehaald uit VKBO:            ${rapport.opgehaald}`)
    console.log(`Ondernemingen ingeladen:       ${rapport.ondernemingenIngeladen}`)
    console.log(`Vestigingen ingeladen:         ${rapport.vestigingenIngeladen} (waarvan ${rapport.zetelsIngeladen} zetelrijen)`)
    console.log(`Nieuwe placeholder-ondernemingen: ${rapport.placeholdersAangemaakt}`)
    console.log(`Adres NIET gevalideerd:        ${rapport.adresNietGevalideerd}`)
    if (rapport.domicilieVerdachtTotaal !== null) {
      console.log(`Domicilieadres-verdacht (>15 op zelfde huisnr): ${rapport.domicilieVerdachtTotaal}`)
    }
  } finally {
    client.release()
    await pool.end()
  }
}

// Enkel de CLI uitvoeren als dit bestand rechtstreeks gestart wordt, niet bij
// een import (bv. vanuit een testbestand). Vergelijken via pathToFileURL, niet
// via een handmatig samengestelde file://-string: op Windows gebruikt
// process.argv[1] backslashes en mist import.meta.url het derde slash-teken
// (file:///C:/...), dus een tekstuele vergelijking faalt daar altijd.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((fout) => {
    console.error('Ingest mislukt:', fout.message)
    process.exit(1)
  })
}
