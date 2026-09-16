// ============================================================================
// REST-API voor de frontend (die er nog niet is). Lichte Express-laag, geen
// Supabase Edge Functions.
// ----------------------------------------------------------------------------
// Waarom Express i.p.v. Supabase Edge Functions: Edge Functions draaien op
// Deno, een ANDER runtime dan de rest van deze repo (Node). Alle logica die
// deze API nodig heeft — de confidence-engine, de databaselaag, de
// domicilie-groepering — staat al in scripts/lib/*.js als gewone Node ES-
// modules. Op Edge Functions overzetten zou die code moeten herschrijven
// (of via een build-stap dupliceren) voor een prototype dat toch al op Node +
// `pg` draait sinds de ingest-scripts (prompt 2-3). Express hergebruikt die
// modules rechtstreeks, zonder duplicatie, en is precies wat de opdracht zelf
// voorstelt ("een lichte Express/FastAPI-laag").
//
// Waarom niet FastAPI: dat is Python; er is nergens Python in deze repo, en
// de databaselaag/domicilielogica/confidence-engine zijn al in JS geschreven
// en getest (prompt 2-4). Overzetten zou puur overhead zijn zonder voordeel.
//
// Een pg.Pool (niet één Client) wordt hier gebruikt: een webserver bedient
// meerdere gelijktijdige requests, en elke functie in de lib-laag doet één
// enkele SQL-statement (geen open transactie nodig) — een Pool volstaat.
// ============================================================================

import express from 'express'
import cors from 'cors'

import { berekenBeoordeling } from '../scripts/lib/confidence-engine.js'
import { bepaalDomicilieBevestiging, groepeerPerAdres } from '../scripts/lib/domicilie.js'
import {
  haalBeoordelingContext,
  haalDomicilieGenoten,
  schrijfBeoordeling,
  beslisOverBeoordeling,
  haalTeControleren,
  haalStratenOverzicht,
  haalEstablishmentsVoorStraat,
  haalVestigingDetail
} from '../scripts/lib/beoordelingen-db.js'

/** Zet een databaserij van haalEstablishmentsVoorStraat om in het API-formaat. */
function naarVestigingEntry (rij) {
  return {
    type: 'vestiging',
    vestiging_id: rij.vestiging_id,
    naam: rij.naam,
    is_maatschappelijke_zetel: rij.is_maatschappelijke_zetel,
    adres: { straat: rij.straat, huisnr: rij.huisnr, postcode: rij.postcode, gemeente: rij.gemeente },
    latitude: rij.latitude,
    longitude: rij.longitude,
    adres_gevalideerd: rij.adres_gevalideerd,
    is_domicilieadres_verdacht: rij.is_domicilieadres_verdacht,
    nace_afdeling_rsz: rij.nace_afdeling_rsz,
    nace_afdeling_btw: rij.nace_afdeling_btw,
    beoordeling: rij.beoordeling_id
      ? {
          id: rij.beoordeling_id,
          zekerheid: rij.zekerheid,
          zekerheid_percentage: rij.zekerheid_percentage,
          voorgestelde_status: rij.voorgestelde_status,
          status: rij.beoordeling_status,
          redenen: rij.redenen,
          aangemaakt_op: rij.beoordeling_aangemaakt_op
        }
      : null
  }
}

/**
 * Bouwt de Express-app. `pool` is een pg.Pool (of, voor tests, elk object met
 * dezelfde `.query(sql, params)`-interface als de rest van de lib-laag).
 */
export function bouwApp (pool) {
  const app = express()
  app.use(cors())
  app.use(express.json())

  // -------------------------------------------------------------- health --
  app.get('/', (req, res) => res.json({ status: 'ok', dienst: 'find-the-real-businesses-api' }))

  // ----------------------------------------------------- GET /straten/:gemeente
  app.get('/straten/:gemeente', async (req, res, next) => {
    try {
      const straten = await haalStratenOverzicht(pool, req.params.gemeente)
      res.json({ gemeente: req.params.gemeente, straten })
    } catch (fout) { next(fout) }
  })

  // ---------------------------------------------- GET /straten/:gemeente/:straat
  app.get('/straten/:gemeente/:straat', async (req, res, next) => {
    try {
      const { gemeente, straat } = req.params
      const rijen = await haalEstablishmentsVoorStraat(pool, { gemeente, straat })

      // Speciaal geval 1 (VME): horen niet thuis in de bedrijvenlijst.
      const uitgesloten = rijen.filter((r) => r.is_vme).map((r) => ({
        vestiging_id: r.vestiging_id,
        naam: r.naam,
        adres: { straat: r.straat, huisnr: r.huisnr, postcode: r.postcode, gemeente: r.gemeente },
        uitgesloten_reden: 'gebouwbeheer_vme'
      }))
      // Speciaal geval 2 (domicilieadres): verdachte adressen samenvouwen.
      // groepeerPerAdres() verwacht de RUWE databaserijen (platte straat/
      // huisnr/is_domicilieadres_verdacht) — pas NA het groeperen zetten we
      // elke rij (los of als lid van een groep) om naar het API-formaat.
      const nietVme = rijen.filter((r) => !r.is_vme)
      const bedrijven = groepeerPerAdres(nietVme).map((entry) =>
        entry.type === 'vestiging'
          ? naarVestigingEntry(entry)
          : {
              type: 'domicilie_groep',
              straat: entry.straat,
              huisnr: entry.huisnr,
              aantal: entry.aantal,
              domicilieadres_bevestigd: entry.domicilieadres_bevestigd,
              reden: entry.reden,
              leden: entry.leden.map(naarVestigingEntry)
            }
      )

      res.json({
        gemeente,
        straat,
        aantal_establishments: rijen.length,
        bedrijven,
        uitgesloten
      })
    } catch (fout) { next(fout) }
  })

  // ----------------------------------------------------------- GET /vestiging/:id
  app.get('/vestiging/:id', async (req, res, next) => {
    try {
      const detail = await haalVestigingDetail(pool, req.params.id)
      if (!detail) return res.status(404).json({ fout: `vestiging ${req.params.id} niet gevonden` })
      const { rij, evidence, huidigeBeoordeling, beoordelingenHistoriek } = detail

      res.json({
        enterprise: {
          id: rij.enterprise_id,
          naam: rij.enterprise_naam,
          handelsnaam: rij.enterprise_handelsnaam,
          rechtsvorm: rij.enterprise_rechtsvorm,
          rechtstoestand: rij.enterprise_rechtstoestand,
          is_gestopt: rij.enterprise_is_gestopt,
          is_placeholder: rij.enterprise_is_placeholder,
          nace_code_btw: rij.enterprise_nace_code_btw,
          nace_omschrijving_btw: rij.enterprise_nace_omschrijving_btw,
          bron: rij.enterprise_bron,
          opgehaald_op: rij.enterprise_opgehaald_op
        },
        establishment: {
          id: rij.id,
          straat: rij.straat,
          huisnr: rij.huisnr,
          postcode: rij.postcode,
          gemeente: rij.gemeente,
          ar_straat: rij.ar_straat,
          ar_huisnr: rij.ar_huisnr,
          ar_postcode: rij.ar_postcode,
          adres_gevalideerd: rij.adres_gevalideerd,
          is_domicilieadres_verdacht: rij.is_domicilieadres_verdacht,
          is_vme: rij.is_vme,
          is_maatschappelijke_zetel: rij.is_maatschappelijke_zetel,
          nace_code_rsz: rij.nace_code_rsz,
          nace_omschrijving_rsz: rij.nace_omschrijving_rsz,
          latitude: rij.latitude,
          longitude: rij.longitude
        },
        // Nooit een placeholder-waarde verzinnen: ontbreekt telefoon/website-
        // evidence, dan blijft dit gewoon leeg. "Contactgegevens onbekend"
        // tonen is de taak van de frontend, niet van deze data-laag.
        evidence, // chronologisch, oudste eerst
        huidige_beoordeling: huidigeBeoordeling,
        beoordelingen_historiek: beoordelingenHistoriek
      })
    } catch (fout) { next(fout) }
  })

  async function berekenEnBewaar (establishmentId) {
    const context = await haalBeoordelingContext(pool, establishmentId)
    if (!context) return null
    let domicilieBevestiging = null
    if (context.establishment.is_domicilieadres_verdacht) {
      domicilieBevestiging = bepaalDomicilieBevestiging(await haalDomicilieGenoten(pool, context.establishment))
    }
    const resultaat = berekenBeoordeling({ ...context, domicilieBevestiging })
    if (resultaat.uitgesloten_reden) return { resultaat, beoordeling: null }
    return { resultaat, beoordeling: await schrijfBeoordeling(pool, { establishmentId, resultaat }) }
  }

  // --------------------------------------------------- POST /vestiging/:id/beoordeel
  app.post('/vestiging/:id/beoordeel', async (req, res, next) => {
    try {
      const uitkomst = await berekenEnBewaar(req.params.id)
      if (!uitkomst) return res.status(404).json({ fout: `vestiging ${req.params.id} niet gevonden` })
      res.json({ vestiging_id: req.params.id, uitgesloten_reden: uitkomst.resultaat.uitgesloten_reden, score: uitkomst.resultaat.score, beoordeling: uitkomst.beoordeling })
    } catch (fout) { next(fout) }
  })

  // Herberekent een volledige straat. Handig na nieuw bewijs; VME's blijven uitgesloten.
  app.post('/straten/:gemeente/:straat/beoordeel', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `select id from establishments where gemeente = $1 and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2) order by id`,
        [req.params.gemeente, req.params.straat]
      )
      const telling = { Hoog: 0, Middel: 0, Laag: 0, uitgesloten: 0 }
      const percentages = []
      for (const { id } of rows) {
        const uitkomst = await berekenEnBewaar(id)
        if (uitkomst.resultaat.uitgesloten_reden) {
          telling.uitgesloten++
        } else {
          telling[uitkomst.beoordeling.zekerheid]++
          percentages.push(uitkomst.beoordeling.zekerheid_percentage)
        }
      }
      const gemiddeldPercentage = percentages.length > 0
        ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
        : null
      res.json({ aantal: rows.length, ...telling, gemiddeld_percentage: gemiddeldPercentage })
    } catch (fout) { next(fout) }
  })

  // ------------------------------------------- POST /beoordeling/:id/bevestig|wijs-af
  async function verwerkBeslissing (req, res, next, beslissing) {
    try {
      const beoordeeldDoor = req.body?.beoordeeld_door
      if (!beoordeeldDoor || typeof beoordeeldDoor !== 'string' || !beoordeeldDoor.trim()) {
        return res.status(400).json({ fout: 'beoordeeld_door is verplicht in de request body' })
      }

      const bestaandR = await pool.query('select id, status from beoordelingen where id = $1', [req.params.id])
      if (bestaandR.rows.length === 0) {
        return res.status(404).json({ fout: `beoordeling ${req.params.id} niet gevonden` })
      }
      if (bestaandR.rows[0].status !== 'te_controleren') {
        return res.status(409).json({ fout: `beoordeling ${req.params.id} is al ${bestaandR.rows[0].status}, kan niet opnieuw beslist worden` })
      }

      const bijgewerkt = await beslisOverBeoordeling(pool, { id: req.params.id, beslissing, beoordeeldDoor: beoordeeldDoor.trim() })
      res.json({ beoordeling: bijgewerkt })
    } catch (fout) { next(fout) }
  }

  app.post('/beoordeling/:id/bevestig', (req, res, next) => verwerkBeslissing(req, res, next, 'bevestigd'))
  app.post('/beoordeling/:id/wijs-af', (req, res, next) => verwerkBeslissing(req, res, next, 'afgewezen'))

  // ---------------------------------------------------------- GET /te-controleren
  app.get('/te-controleren', async (req, res, next) => {
    try {
      const rijen = await haalTeControleren(pool)
      res.json({
        aantal: rijen.length,
        beoordelingen: rijen.map((r) => ({
          id: r.id,
          establishment_id: r.establishment_id,
          naam: r.naam,
          adres: r.establishment_id ? { straat: r.straat, huisnr: r.huisnr, postcode: r.postcode, gemeente: r.gemeente } : null,
          zekerheid: r.zekerheid,
          zekerheid_percentage: r.zekerheid_percentage,
          redenen: r.redenen,
          voorgestelde_status: r.voorgestelde_status,
          voorstel_tekst: r.voorstel_tekst,
          status: r.status,
          aangemaakt_op: r.aangemaakt_op
        }))
      })
    } catch (fout) { next(fout) }
  })

  // eslint-disable-next-line no-unused-vars
  app.use((fout, req, res, next) => {
    console.error(fout)
    res.status(500).json({ fout: fout.message })
  })

  return app
}
