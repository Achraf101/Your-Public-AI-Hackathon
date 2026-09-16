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

try {
  const doelgroep = await pool.query(
    `select id, straat from establishments
     where gemeente = $1 and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2) and not is_vme
     order by id`,
    [gemeente, straat]
  )

  await pool.query('BEGIN')
  await pool.query(`delete from evidence where bron = 'demo_mock' and establishment_id = any($1::text[])`, [doelgroep.rows.map((r) => r.id)])
  // Herstel eerst een geldig lokaal adres. Daarna markeren we een kleine,
  // duidelijk gelabelde demo-groep als adresconflict.
  await pool.query(`update establishments set ar_straat = straat where id = any($1::text[])`, [doelgroep.rows.map((r) => r.id)])

  const telling = { Hoog: 0, Middel: 0, Laag: 0 }
  for (const [index, establishment] of doelgroep.rows.entries()) {
    const groep = index % 10
    if (groep < 2) {
      // Rood: twee negatieve signalen ondanks een geldig registeradres.
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'status', 'CLOSED_PERMANENTLY', '{"demo":true}')`, [establishment.id]
      )
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'geen_match_gevonden', 'Demo: geen betrouwbare online match', '{"demo":true}')`, [establishment.id]
      )
      telling.Laag++
    } else if (groep < 4) {
      // Oranje: live-signaal zegt open, maar het mock-registeradres klopt niet.
      await pool.query(`update establishments set ar_straat = 'Mocklocatie - controle nodig' where id = $1`, [establishment.id])
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'status', 'OPERATIONAL', '{"demo":true}')`, [establishment.id]
      )
      telling.Middel++
    } else {
      // Groen: drie onafhankelijke positieve signalen.
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'status', 'OPERATIONAL', '{"demo":true}')`, [establishment.id]
      )
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'website', $2, '{"demo":true}')`, [establishment.id, `https://demo.local/zaak/${establishment.id}`]
      )
      await pool.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload)
         values ($1, 'demo_mock', 'reviews_samenvatting', '4.6 (42 demo-reviews)', '{"demo":true,"userRatingCount":42}')`, [establishment.id]
      )
      telling.Hoog++
    }
  }
  await pool.query('COMMIT')
  console.log(`Demo-mocks klaar: ${telling.Hoog} Hoog/groen, ${telling.Middel} Middel/oranje, ${telling.Laag} Laag/rood.`)
} catch (fout) {
  await pool.query('ROLLBACK')
  throw fout
} finally {
  await pool.end()
}
