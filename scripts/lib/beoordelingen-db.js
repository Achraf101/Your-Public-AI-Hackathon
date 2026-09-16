// ============================================================================
// Databaselaag voor de confidence-engine en de API-endpoints. Zelfde
// interface-conventie als de andere lib-bestanden: elke functie neemt een
// `db` met `.query(sql, params)`. De meeste functies hier zijn één enkele
// SQL-statement en werken dus prima met een pg.Pool rechtstreeks (geen
// uitgecheckte Client nodig) — er wordt hier nergens een transactie geopend.
// ============================================================================

/**
 * Alles wat de confidence-engine nodig heeft voor één vestiging:
 * establishment- en enterprise-velden, en alle evidence chronologisch.
 * Retourneert null als de vestiging niet bestaat.
 */
export async function haalBeoordelingContext (db, establishmentId) {
  const r = await db.query(
    `select
       e.id, e.enterprise_id, e.straat, e.huisnr, e.postcode, e.gemeente,
       e.ar_straat, e.adres_gevalideerd, e.is_vme, e.is_domicilieadres_verdacht,
       e.is_maatschappelijke_zetel,
       ent.naam as enterprise_naam, ent.handelsnaam as enterprise_handelsnaam,
       ent.is_gestopt as enterprise_is_gestopt, ent.is_placeholder as enterprise_is_placeholder
     from establishments e
     join enterprises ent on ent.id = e.enterprise_id
     where e.id = $1`,
    [establishmentId]
  )
  if (r.rows.length === 0) return null
  const rij = r.rows[0]

  const evidenceR = await db.query(
    `select type, waarde, ruwe_payload, bron, bron_url, opgehaald_op
     from evidence
     where establishment_id = $1
     order by opgehaald_op asc`,
    [establishmentId]
  )

  return {
    establishment: {
      id: rij.id,
      enterprise_id: rij.enterprise_id,
      straat: rij.straat,
      huisnr: rij.huisnr,
      postcode: rij.postcode,
      gemeente: rij.gemeente,
      ar_straat: rij.ar_straat,
      adres_gevalideerd: rij.adres_gevalideerd,
      is_vme: rij.is_vme,
      is_domicilieadres_verdacht: rij.is_domicilieadres_verdacht,
      is_maatschappelijke_zetel: rij.is_maatschappelijke_zetel
    },
    enterprise: {
      id: rij.enterprise_id,
      naam: rij.enterprise_naam,
      handelsnaam: rij.enterprise_handelsnaam,
      is_gestopt: rij.enterprise_is_gestopt,
      is_placeholder: rij.enterprise_is_placeholder
    },
    evidence: evidenceR.rows
  }
}

/**
 * Alle vestigingen die hetzelfde (gemeente, straat, huisnr) delen als de
 * gegeven vestiging, met hun NACE-afdeling erbij — nodig voor
 * bepaalDomicilieBevestiging() (domicilie.js). Enkel zinvol op te roepen als
 * establishment.is_domicilieadres_verdacht true is.
 */
export async function haalDomicilieGenoten (db, { gemeente, straat, huisnr }) {
  const r = await db.query(
    `select
       e.id, e.straat, e.huisnr,
       nace_afdeling(e.nace_code_rsz) as nace_afdeling_rsz,
       nace_afdeling(ent.nace_code_btw) as nace_afdeling_btw
     from establishments e
     join enterprises ent on ent.id = e.enterprise_id
     where e.gemeente = $1
       and vkbo_straat_sleutel(e.straat) = vkbo_straat_sleutel($2)
       and nullif(btrim(coalesce(e.huisnr, '')), '') = nullif(btrim(coalesce($3, '')), '')`,
    [gemeente, straat, huisnr]
  )
  return r.rows
}

/**
 * Slaat het resultaat van de confidence-engine op. Bestaat er al een
 * OPENSTAAND voorstel (status='te_controleren') voor deze vestiging, dan
 * wordt dat vervangen (UPDATE) in plaats van een duplicaat aan te maken — een
 * nog niet beoordeeld voorstel bevat geen menselijke beslissing, dus mag
 * gerust verversd worden. Is het vorige voorstel al bevestigd of afgewezen
 * (een menselijke beslissing), dan komt er een NIEUWE rij bij: die
 * geschiedenis raakt nooit overschreven.
 *
 * Retourneert null zonder iets te schrijven bij uitgesloten_reden (VME) — zie
 * confidence-engine.js.
 */
export async function schrijfBeoordeling (db, { establishmentId, resultaat }) {
  if (resultaat.uitgesloten_reden) return null

  const bestaand = await db.query(
    `select id from beoordelingen where establishment_id = $1 and status = 'te_controleren'`,
    [establishmentId]
  )

  if (bestaand.rows.length > 0) {
    const r = await db.query(
      `update beoordelingen
       set zekerheid = $2, redenen = $3::jsonb, voorgestelde_status = $4, voorstel_tekst = $5, aangemaakt_op = now()
       where id = $1
       returning *`,
      [bestaand.rows[0].id, resultaat.zekerheid, JSON.stringify(resultaat.redenen), resultaat.voorgestelde_status, resultaat.voorstel_tekst]
    )
    return r.rows[0]
  }

  const r = await db.query(
    `insert into beoordelingen (establishment_id, zekerheid, redenen, voorgestelde_status, voorstel_tekst)
     values ($1, $2, $3::jsonb, $4, $5)
     returning *`,
    [establishmentId, resultaat.zekerheid, JSON.stringify(resultaat.redenen), resultaat.voorgestelde_status, resultaat.voorstel_tekst]
  )
  return r.rows[0]
}

/** Meest recente beoordeling voor een vestiging (eender welke status), of null. */
export async function haalHuidigeBeoordeling (db, establishmentId) {
  const r = await db.query(
    `select * from beoordelingen where establishment_id = $1 order by aangemaakt_op desc limit 1`,
    [establishmentId]
  )
  return r.rows[0] ?? null
}

/**
 * Bevestigt of wijst een voorstel af. Faalt stil (retourneert null) als het
 * voorstel niet bestaat of al behandeld was — de aanroeper (server/app.js)
 * zet dat om in een 404/409, nooit in een stille overschrijving van een
 * eerdere beslissing.
 */
export async function beslisOverBeoordeling (db, { id, beslissing, beoordeeldDoor }) {
  const r = await db.query(
    `update beoordelingen
     set status = $2, beoordeeld_door = $3, beoordeeld_op = now()
     where id = $1 and status = 'te_controleren'
     returning *`,
    [id, beslissing, beoordeeldDoor]
  )
  return r.rows[0] ?? null
}

/** Alle openstaande voorstellen, Laag eerst (dat is wat de meeste aandacht vraagt). */
export async function haalTeControleren (db) {
  const r = await db.query(
    `select b.*, e.straat, e.huisnr, e.postcode, e.gemeente,
            coalesce(ent.handelsnaam, ent.naam) as naam
     from beoordelingen b
     left join establishments e on e.id = b.establishment_id
     left join enterprises ent on ent.id = e.enterprise_id
     where b.status = 'te_controleren'
     order by case b.zekerheid when 'Laag' then 0 when 'Middel' then 1 when 'Hoog' then 2 else 3 end,
              b.aangemaakt_op asc`
  )
  return r.rows
}

/** Straten van een gemeente, met aantal establishments per straat. */
export async function haalStratenOverzicht (db, gemeente) {
  const r = await db.query(
    `select min(straat) as straat, count(*)::int as aantal_records
     from establishments
     where gemeente = $1 and straat is not null
     group by vkbo_straat_sleutel(straat)
     order by min(straat)`,
    [gemeente]
  )
  return r.rows
}

/**
 * Alle vestigingen van een straat, met NACE-afdeling en hun laatste
 * beoordeling erbij (LEFT JOIN LATERAL: de meest recente rij per vestiging).
 */
export async function haalEstablishmentsVoorStraat (db, { gemeente, straat }) {
  const r = await db.query(
    `select
       e.id as vestiging_id, e.straat, e.huisnr, e.postcode, e.gemeente,
       e.latitude, e.longitude,
       e.adres_gevalideerd, e.is_vme, e.is_domicilieadres_verdacht, e.is_maatschappelijke_zetel,
       coalesce(ent.handelsnaam, ent.naam) as naam,
       ent.is_gestopt as enterprise_is_gestopt,
       nace_afdeling(e.nace_code_rsz) as nace_afdeling_rsz,
       nace_afdeling(ent.nace_code_btw) as nace_afdeling_btw,
       b.id as beoordeling_id, b.zekerheid, b.voorgestelde_status, b.status as beoordeling_status,
       b.redenen, b.aangemaakt_op as beoordeling_aangemaakt_op
     from establishments e
     join enterprises ent on ent.id = e.enterprise_id
     left join lateral (
       select * from beoordelingen bo
       where bo.establishment_id = e.id
       order by bo.aangemaakt_op desc
       limit 1
     ) b on true
     where e.gemeente = $1
       and vkbo_straat_sleutel(e.straat) = vkbo_straat_sleutel($2)
     order by e.id`,
    [gemeente, straat]
  )
  return r.rows
}

/** Volledig detail van één vestiging: onderneming + vestiging + evidence + huidige beoordeling. */
export async function haalVestigingDetail (db, establishmentId) {
  const r = await db.query(
    `select
       e.*,
       ent.naam as enterprise_naam, ent.handelsnaam as enterprise_handelsnaam,
       ent.rechtsvorm as enterprise_rechtsvorm, ent.rechtstoestand as enterprise_rechtstoestand,
       ent.is_gestopt as enterprise_is_gestopt, ent.is_placeholder as enterprise_is_placeholder,
       ent.nace_code_btw as enterprise_nace_code_btw, ent.nace_omschrijving_btw as enterprise_nace_omschrijving_btw,
       ent.bron as enterprise_bron, ent.opgehaald_op as enterprise_opgehaald_op
     from establishments e
     join enterprises ent on ent.id = e.enterprise_id
     where e.id = $1`,
    [establishmentId]
  )
  if (r.rows.length === 0) return null

  const evidenceR = await db.query(
    `select id, bron, type, waarde, ruwe_payload, bron_url, opgehaald_op
     from evidence
     where establishment_id = $1
     order by opgehaald_op asc`,
    [establishmentId]
  )

  const historiekR = await db.query(
    `select * from beoordelingen where establishment_id = $1 order by aangemaakt_op desc`,
    [establishmentId]
  )

  return {
    rij: r.rows[0],
    evidence: evidenceR.rows,
    huidigeBeoordeling: historiekR.rows[0] ?? null,
    beoordelingenHistoriek: historiekR.rows
  }
}
