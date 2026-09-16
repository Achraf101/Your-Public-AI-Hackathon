#!/usr/bin/env node
// Vult de lokale demo bewust met GELABELDE mock-signalen. Hierdoor zijn alle
// kleuren, filters en kaartcategorieën direct te demonstreren zonder een
// betaalde Google Places-key of verzonnen "live" bewijs.

import pg from 'pg'

const [gemeente, straat] = process.argv.slice(2)
if (!gemeente || !straat || !process.env.DATABASE_URL) {
  console.error('Gebruik: npm run demo-data -- <gemeente> <straat> (met DATABASE_URL)')
  process.exit(1)
}

const gebruiktSSL = !/localhost|127\.0\.0\.1|@db:/.test(process.env.DATABASE_URL) && process.env.PGSSLMODE !== 'disable'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: gebruiktSSL ? { rejectUnauthorized: false } : undefined })

// Elke kleur heeft meerdere profielen met meer of minder signalen. Zonder dat
// haalt élke zaak van dezelfde kleur exact dezelfde score, en dus exact
// hetzelfde percentage — dan zegt "83%" niets meer dan het woord "Hoog". Met
// deze profielen spreidt de demo over de hele schaal (8% tot 95%) zonder dat
// de drie kleurcategorieën vervagen.
//
// `ar` stuurt het adressignaal via ar_straat: 'straat' = identiek aan het
// KBO-adres (gevalideerd, +1), null = nooit gecontroleerd (-1), 'mock' = het
// adressenregister spreekt het KBO tegen. adres_gevalideerd zelf is een
// generated column en kan niet rechtstreeks gezet worden.
const PROFIELEN = {
  // Rood: meerdere negatieve signalen → 31%, 8%, 17%, 8%
  Laag: [
    { ar: 'straat', status: 'CLOSED_PERMANENTLY', geenMatch: true },
    { ar: null, status: 'CLOSED_PERMANENTLY', geenMatch: true },
    { ar: null, status: null, geenMatch: true },
    { ar: null, status: 'CLOSED_TEMPORARILY', geenMatch: true }
  ],
  // Oranje: open volgens Google, maar het registeradres klopt niet → 50%, 69%
  Middel: [
    { ar: 'mock', status: 'OPERATIONAL' },
    { ar: 'mock', status: 'OPERATIONAL', website: true },
    { ar: 'mock', status: 'OPERATIONAL', reviews: 7 },
    { ar: 'mock', status: 'OPERATIONAL' }
  ],
  // Groen: open én op het juiste adres, met meer of minder bewijs erbij, wat
  // het verschil maakt tussen "vrij zeker" en "zo zeker als publieke bronnen
  // kunnen zijn" → 95%, 92%, 92%, 83%
  Hoog: [
    { ar: 'straat', status: 'OPERATIONAL', website: true, reviews: 42 },
    { ar: 'straat', status: 'OPERATIONAL', website: true },
    { ar: 'straat', status: 'OPERATIONAL', reviews: 187 },
    { ar: 'straat', status: 'OPERATIONAL' }
  ]
}

try {
  const doelgroep = await pool.query(
    `select id, straat from establishments
     where gemeente = $1 and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2) and not is_vme
     order by id`,
    [gemeente, straat]
  )

  await pool.query('BEGIN')
  await pool.query(`delete from evidence where bron = 'demo_mock' and establishment_id = any($1::text[])`, [doelgroep.rows.map((r) => r.id)])
  // Herstel eerst overal een geldig lokaal adres; elk profiel zet daarna zijn
  // eigen adressignaal.
  await pool.query(`update establishments set ar_straat = straat where id = any($1::text[])`, [doelgroep.rows.map((r) => r.id)])

  async function schrijfProfiel (establishment, profiel) {
    if (profiel.ar === 'straat') {
      await pool.query('update establishments set ar_straat = straat where id = $1', [establishment.id])
    } else if (profiel.ar === 'mock') {
      await pool.query("update establishments set ar_straat = 'Mocklocatie - controle nodig' where id = $1", [establishment.id])
    } else {
      await pool.query('update establishments set ar_straat = null where id = $1', [establishment.id])
    }

    if (profiel.status) {
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'status', $2, '{"demo":true}')`, [establishment.id, profiel.status]
      )
    }
    if (profiel.geenMatch) {
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'geen_match_gevonden', 'Demo: geen betrouwbare online match', '{"demo":true}')`, [establishment.id]
      )
    }
    if (profiel.website) {
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'website', $2, '{"demo":true}')`,
        [establishment.id, `https://demo.local/zaak/${establishment.id}`]
      )
    }
    if (profiel.reviews) {
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'reviews_samenvatting', $2, $3::jsonb)`,
        [establishment.id, `4.6 (${profiel.reviews} demo-reviews)`, JSON.stringify({ demo: true, userRatingCount: profiel.reviews })]
      )
    }
  }

  const telling = { Hoog: 0, Middel: 0, Laag: 0 }
  for (const [index, establishment] of doelgroep.rows.entries()) {
    const groep = index % 10
    const kleur = groep < 2 ? 'Laag' : groep < 4 ? 'Middel' : 'Hoog'
    const profielen = PROFIELEN[kleur]
    await schrijfProfiel(establishment, profielen[Math.floor(index / 10) % profielen.length])
    telling[kleur]++
  }
  await pool.query('COMMIT')
  console.log(`Demo-mocks klaar: ${telling.Hoog} Hoog/groen, ${telling.Middel} Middel/oranje, ${telling.Laag} Laag/rood (elk in meerdere varianten, zodat de percentages spreiden).`)
} catch (fout) {
  await pool.query('ROLLBACK')
  throw fout
} finally {
  await pool.end()
}
