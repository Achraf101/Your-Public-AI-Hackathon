#!/usr/bin/env node
// Berekent voorstellen voor elke vestiging van een straat. Dit verandert nooit
// het KBO-register: alleen openstaande voorstellen in `beoordelingen`.

import pg from 'pg'
import { berekenBeoordeling } from './lib/confidence-engine.js'
import { bepaalDomicilieBevestiging } from './lib/domicilie.js'
import {
  haalBeoordelingContext,
  haalDomicilieGenoten,
  schrijfBeoordeling
} from './lib/beoordelingen-db.js'

const [gemeente, straat] = process.argv.slice(2)
if (!gemeente || !straat) {
  console.error('Gebruik: npm run beoordeel -- <gemeente> <straat>')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ontbreekt. Zie .env.example.')
  process.exit(1)
}

const gebruiktSSL = !/localhost|127\.0\.0\.1|@db:/.test(process.env.DATABASE_URL) && process.env.PGSSLMODE !== 'disable'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: gebruiktSSL ? { rejectUnauthorized: false } : undefined })

async function beoordeelVestiging (id) {
  const context = await haalBeoordelingContext(pool, id)
  let domicilieBevestiging = null
  if (context.establishment.is_domicilieadres_verdacht) {
    domicilieBevestiging = bepaalDomicilieBevestiging(await haalDomicilieGenoten(pool, context.establishment))
  }
  const resultaat = berekenBeoordeling({ ...context, domicilieBevestiging })
  if (resultaat.uitgesloten_reden) return { uitgesloten: true }
  const beoordeling = await schrijfBeoordeling(pool, { establishmentId: id, resultaat })
  return { uitgesloten: false, zekerheid: beoordeling.zekerheid, percentage: beoordeling.zekerheid_percentage }
}

try {
  const { rows } = await pool.query(
    `select id from establishments
     where gemeente = $1 and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2)
     order by id`,
    [gemeente, straat]
  )
  const telling = { Hoog: 0, Middel: 0, Laag: 0, uitgesloten: 0 }
  const percentages = []
  for (const { id } of rows) {
    const resultaat = await beoordeelVestiging(id)
    if (resultaat.uitgesloten) {
      telling.uitgesloten++
    } else {
      telling[resultaat.zekerheid]++
      percentages.push(resultaat.percentage)
    }
  }
  const gemiddelde = percentages.length > 0
    ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
    : null
  console.log(`Beoordelingen voor ${gemeente} / ${straat}: ${telling.Hoog} Hoog (≥70%), ${telling.Middel} Middel (40-69%), ${telling.Laag} Laag (<40%), ${telling.uitgesloten} VME uitgesloten.`)
  if (gemiddelde !== null) console.log(`Gemiddelde kans dat een zaak echt actief is: ${gemiddelde}%.`)
} finally {
  await pool.end()
}
