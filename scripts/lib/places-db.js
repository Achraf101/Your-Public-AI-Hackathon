// ============================================================================
// Databaselaag voor de Google Places-verrijking. Zelfde interface-conventie
// als scripts/lib/database.js: elke functie neemt een `db` met een
// `.query(sql, params)`-methode; de aanroeper geeft een uitgecheckte,
// single-connection client door (geen Pool), zodat BEGIN/COMMIT werkt.
//
// Per vestiging wordt een APARTE, kleine transactie gebruikt — niet één
// transactie voor de hele run. Een crash bij vestiging 30 mag de evidence van
// vestiging 1 t/m 29 niet ongedaan maken: die Places-calls zijn al betaald en
// mogen niet verloren gaan. Zie scripts/verrijk-google-places.js.
// ============================================================================

/**
 * Haalt de vestigingen van één straat op, met alles wat nodig is om te
 * beslissen of we ze deze run moeten verwerken:
 *  - zoeknaam: handelsnaam, anders de maatschappelijke naam. establishments
 *    heeft zelf geen naam-kolom (die hoort bij de onderneming, zie schema),
 *    vandaar de join.
 *  - is_placeholder: TRUE bij een vestiging waarvan de moederonderneming nog
 *    niet verrijkt is (zie ingest-vkbo.js) — dan is er geen naam om op te
 *    zoeken, dus die slaan we over, niet als "geen match" maar als "niet
 *    verwerkt" (we hebben immers niet eens gezocht).
 *  - al_vandaag_opgehaald: TRUE als er al evidence van bron google_places van
 *    vandaag bestaat -> voorkomt dubbele calls bij een herstart.
 */
export async function haalVestigingenVoorStraat (db, { gemeente, straat }) {
  const r = await db.query(
    `select
       e.id as vestiging_id,
       e.straat, e.huisnr, e.postcode, e.gemeente,
       coalesce(ent.handelsnaam, ent.naam) as zoeknaam,
       ent.is_placeholder,
       exists (
         select 1 from evidence ev
         where ev.establishment_id = e.id
           and ev.bron = 'google_places'
           and date_trunc('day', ev.opgehaald_op) = date_trunc('day', now())
       ) as al_vandaag_opgehaald
     from establishments e
     join enterprises ent on ent.id = e.enterprise_id
     where e.gemeente = $1
       and vkbo_straat_sleutel(e.straat) = vkbo_straat_sleutel($2)
     order by e.id`,
    [gemeente, straat]
  )
  return r.rows
}

/**
 * Schrijft één evidence-rij per aanwezig signaal (status/telefoon/website/
 * uren/reviews_samenvatting) — nooit alles in één blob, en nooit een rij voor
 * een veld dat Google niet teruggaf (geen lege string als "gevonden"
 * evidence). Alles in één kleine transactie: van deze ene match komen ofwel
 * alle signalen erbij, ofwel geen enkele.
 *
 * @returns {Promise<number>} aantal weggeschreven evidence-rijen.
 */
export async function schrijfMatchEvidence (db, { establishmentId, details, bronUrl }) {
  const rijen = []

  if (details.businessStatus) {
    rijen.push({ type: 'status', waarde: details.businessStatus, ruwePayload: { businessStatus: details.businessStatus } })
  }
  if (details.nationalPhoneNumber) {
    rijen.push({ type: 'telefoon', waarde: details.nationalPhoneNumber, ruwePayload: null })
  }
  if (details.websiteUri) {
    rijen.push({ type: 'website', waarde: details.websiteUri, ruwePayload: null })
  }
  if (details.currentOpeningHours) {
    rijen.push({
      type: 'uren',
      waarde: JSON.stringify(details.currentOpeningHours),
      ruwePayload: details.currentOpeningHours
    })
  }
  if (details.rating !== undefined || details.userRatingCount !== undefined) {
    const rating = details.rating !== undefined ? details.rating : '?'
    const aantal = details.userRatingCount !== undefined ? details.userRatingCount : 0
    rijen.push({
      type: 'reviews_samenvatting',
      waarde: `${rating} (${aantal} reviews)`,
      ruwePayload: { rating: details.rating ?? null, userRatingCount: details.userRatingCount ?? null }
    })
  }

  if (rijen.length === 0) return 0 // Place Details gaf niets bruikbaars terug

  await db.query('BEGIN')
  try {
    for (const rij of rijen) {
      await db.query(
        `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload, bron_url, opgehaald_op)
         values ($1, 'google_places', $2, $3, $4, $5, now())`,
        [establishmentId, rij.type, rij.waarde, rij.ruwePayload, bronUrl ?? null]
      )
    }
    await db.query('COMMIT')
  } catch (fout) {
    await db.query('ROLLBACK')
    throw fout
  }
  return rijen.length
}

/**
 * Schrijft de "we hebben gezocht maar niets betrouwbaars gevonden"-rij.
 * ruwePayload bewaart de ruwe Text Search-kandidatenlijst, zodat een
 * ambtenaar of ontwikkelaar achteraf kan nakijken waarom er geen match was.
 */
export async function schrijfGeenMatchEvidence (db, { establishmentId, reden, ruwePayload }) {
  await db.query(
    `insert into evidence (establishment_id, bron, type, waarde, ruwe_payload, opgehaald_op)
     values ($1, 'google_places', 'geen_match_gevonden', $2, $3, now())`,
    [establishmentId, reden, ruwePayload ?? null]
  )
}
