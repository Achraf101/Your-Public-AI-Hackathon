// ============================================================================
// Databaselaag van de ingest. Elke functie neemt een `db` met een
// `.query(sql, params)`-methode die `{ rows }` teruggeeft — dat is precies de
// vorm van zowel een node-postgres Client/PoolClient als van PGlite. Daardoor
// draait exact dezelfde code in productie (tegen Supabase, via pg) en in de
// tests (tegen PGlite, in-process, geen server nodig).
//
// BELANGRIJK: geef hier nooit een pg.Pool zelf door, enkel een uitgecheckte
// Client. ingestStraat() opent een transactie met BEGIN/COMMIT; een Pool kan
// elke query op een andere fysieke connectie uitvoeren, waardoor die
// statements stil buiten de transactie zouden vallen. Zie ingest-vkbo.js.
//
// adres_gevalideerd (GENERATED kolom) en is_vme (bijgehouden door een
// trigger) worden hier nergens in JS herberekend: de database is daar de
// enige bron van waarheid, zie supabase/migrations/20260916*.sql. Deze
// functies lezen die kolommen enkel terug (via RETURNING) om te rapporteren.
// ============================================================================

/**
 * Maakt, indien nodig, een placeholder-onderneming aan zodat een vestiging
 * haar zetel kan aanwijzen (foreign key). Dit is dezelfde logica als de
 * SQL-functie zorg_voor_onderneming() uit de migratie, maar met een RETURNING
 * erbij: we willen in het ingest-rapport kunnen tonen hoeveel placeholders er
 * deze run bijgekomen zijn.
 *
 * @returns {Promise<boolean>} true als er een NIEUWE placeholder is aangemaakt.
 */
export async function zorgVoorOnderneming (db, ondernemingsnr) {
  const r = await db.query(
    `insert into enterprises (id, bron, is_placeholder)
     values ($1, 'afgeleid_uit_vestiging', true)
     on conflict (id) do nothing
     returning id`,
    [ondernemingsnr]
  )
  return r.rows.length > 0
}

/**
 * Upsert van een onderneming. Bestond de rij al als placeholder (aangemaakt
 * door zorgVoorOnderneming voor een eerder ingelezen vestiging), dan wordt ze
 * hier verrijkt en is_placeholder alsnog op false gezet. De trigger
 * enterprises_sync_vestigingen_is_vme werkt in dat geval automatisch is_vme
 * bij op alle vestigingen die al naar deze onderneming verwezen.
 */
export async function upsertOnderneming (db, o) {
  const r = await db.query(
    `insert into enterprises (id, naam, handelsnaam, rechtsvorm, rechtstoestand, datum_stopzetting, nace_code_btw, nace_omschrijving_btw, bron, opgehaald_op, is_placeholder)
     values ($1, $2, $3, $4, $5, $6::date, $7, $8, 'vkbo', now(), false)
     on conflict (id) do update set
       naam                  = excluded.naam,
       handelsnaam            = excluded.handelsnaam,
       rechtsvorm              = excluded.rechtsvorm,
       rechtstoestand          = excluded.rechtstoestand,
       datum_stopzetting      = excluded.datum_stopzetting,
       nace_code_btw           = excluded.nace_code_btw,
       nace_omschrijving_btw   = excluded.nace_omschrijving_btw,
       bron                    = excluded.bron,
       opgehaald_op           = excluded.opgehaald_op,
       is_placeholder          = false
     returning id, is_gestopt, is_vme`,
    [o.id, o.naam, o.handelsnaam, o.rechtsvorm, o.rechtstoestand, o.datumStopzetting, o.naceCodeBtw, o.naceOmschrijvingBtw]
  )
  return r.rows[0]
}

/**
 * Upsert van een vestiging — zowel een "echte" vestigingseenheid als de
 * zetel-rij van een onderneming (is_maatschappelijke_zetel = true, id gelijk
 * aan enterpriseId). is_maatschappelijke_zetel wordt bewust NIET in de UPDATE
 * meegenomen: die ligt vast bij de eerste keer dat de rij wordt aangemaakt en
 * mag niet wisselen op een volgende ingest-run.
 */
export async function upsertVestiging (db, v) {
  const r = await db.query(
    `insert into establishments (
       id, enterprise_id, is_maatschappelijke_zetel,
       straat, huisnr, postcode, gemeente,
       ar_straat, ar_huisnr, ar_postcode,
       nace_code_rsz, nace_omschrijving_rsz,
       latitude, longitude, bron, opgehaald_op
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'vkbo', now())
     on conflict (id) do update set
       enterprise_id          = excluded.enterprise_id,
       straat                  = excluded.straat,
       huisnr                  = excluded.huisnr,
       postcode                = excluded.postcode,
       gemeente                = excluded.gemeente,
       ar_straat               = excluded.ar_straat,
       ar_huisnr               = excluded.ar_huisnr,
       ar_postcode             = excluded.ar_postcode,
       nace_code_rsz           = excluded.nace_code_rsz,
       nace_omschrijving_rsz   = excluded.nace_omschrijving_rsz,
       latitude                = excluded.latitude,
       longitude               = excluded.longitude,
       bron                    = excluded.bron,
       opgehaald_op           = excluded.opgehaald_op
     returning id, adres_gevalideerd, is_vme, is_maatschappelijke_zetel`,
    [
      v.id, v.enterpriseId, v.isZetel,
      v.straat, v.huisnr, v.postcode, v.gemeente,
      v.arStraat, v.arHuisnr, v.arPostcode,
      v.naceCodeRsz, v.naceOmschrijvingRsz,
      v.latitude, v.longitude
    ]
  )
  return r.rows[0]
}

/**
 * Telt, voor de zonet ingelezen straat, hoeveel vestigingen hetzelfde
 * (straat, huisnr) delen en zet is_domicilieadres_verdacht op TRUE voor elke
 * groep van meer dan 15, en terug op FALSE zodra een groep niet langer boven
 * de drempel zit. Straatnamen worden vergeleken via vkbo_straat_sleutel()
 * (dezelfde normalisatie als adres_gevalideerd) zodat schrijfwijzevarianten
 * niet als aparte straten tellen.
 *
 * Bewust beperkt tot gemeente + straat van de huidige run: dit is een
 * register-signaal, geen definitief oordeel (zie README) — een latere
 * Google Places-koppeling moet dit nog bevestigen.
 *
 * @returns {Promise<Array<{id: string}>>} de vestigingen waarvan de vlag
 *   deze run daadwerkelijk gewijzigd is.
 */
export async function herberekenDomicilieVerdacht (db, { gemeente, straat }) {
  const r = await db.query(
    `with doelgroep as (
       select id,
              vkbo_straat_sleutel(straat) as straat_sleutel,
              nullif(btrim(coalesce(huisnr, '')), '') as huisnr_sleutel
       from establishments
       where gemeente = $1
         and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2)
     ),
     telling as (
       select straat_sleutel, huisnr_sleutel, count(*) as aantal
       from doelgroep
       group by straat_sleutel, huisnr_sleutel
     )
     update establishments e
     set is_domicilieadres_verdacht = (t.aantal > 15)
     from doelgroep d
     join telling t using (straat_sleutel, huisnr_sleutel)
     where e.id = d.id
       and e.is_domicilieadres_verdacht is distinct from (t.aantal > 15)
     returning e.id`,
    [gemeente, straat]
  )
  return r.rows
}

/** Huidig totaal aantal vestigingen met is_domicilieadres_verdacht in deze straat. */
export async function telDomicilieVerdacht (db, { gemeente, straat }) {
  const r = await db.query(
    `select count(*)::int as aantal
     from establishments
     where gemeente = $1
       and vkbo_straat_sleutel(straat) = vkbo_straat_sleutel($2)
       and is_domicilieadres_verdacht`,
    [gemeente, straat]
  )
  return r.rows[0].aantal
}
