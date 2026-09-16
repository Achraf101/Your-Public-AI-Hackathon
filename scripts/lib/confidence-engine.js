// ============================================================================
// Confidence-engine: vertaalt evidence + registersignalen naar een voorstel
// (zekerheid + voorgestelde_status + redenen), voor precies één vestiging.
// ----------------------------------------------------------------------------
// Puur functioneel, geen database-toegang — makkelijk te testen en te
// controleren. De aanroeper (beoordelingen-db.js) haalt de nodige data op en
// schrijft het resultaat pas weg. "Geen black box" (zie het datamodel uit
// prompt 1) betekent hier letterlijk: elk signaal levert een eigen leesbare
// regel in `redenen`, opgeteld tot één score, nooit een ondoorzichtig getal.
// ============================================================================

// De drempels waarmee een percentage weer een band (Hoog/Middel/Laag) wordt.
// Bewust op één plek: kleuren, filters en sortering in de frontend gebruiken
// dezelfde grenzen.
export const ZEKERHEID_DREMPEL_HOOG = 70
export const ZEKERHEID_DREMPEL_MIDDEL = 40

// Steilheid van de omzetting score -> percentage. 0.8 geeft een reeks die
// dicht bij de oude drempels blijft en nooit 0% of 100% claimt:
//   score  -4   -3   -2   -1    0    1    2    3    4
//   pct     5%   8%  17%  31%  50%  69%  83%  92%  95%
const PERCENTAGE_STEILHEID = 0.8
// Nooit volledige zekerheid suggereren: acht signalen blijven acht signalen,
// geen bewijs. Daarom afgetopt op 5%-95%.
const PERCENTAGE_MIN = 5
const PERCENTAGE_MAX = 95

/**
 * Zet de opgetelde score om in een kans (in hele procenten) dat de zaak echt
 * actief is op het geregistreerde adres. Logistische curve rond score 0 = 50%:
 * elk extra signaal weegt door, maar de uitersten lopen nooit naar 0 of 100.
 * Puur een herschaling van de score — geen nieuwe signalen, geen weging.
 */
export function percentageVanScore (score) {
  const ruw = 100 / (1 + Math.exp(-PERCENTAGE_STEILHEID * score))
  return Math.min(PERCENTAGE_MAX, Math.max(PERCENTAGE_MIN, Math.round(ruw)))
}

/** Percentage -> Hoog / Middel / Laag, met de drempels hierboven. */
export function bandVanPercentage (percentage) {
  if (percentage >= ZEKERHEID_DREMPEL_HOOG) return 'Hoog'
  if (percentage >= ZEKERHEID_DREMPEL_MIDDEL) return 'Middel'
  return 'Laag'
}

/** Meest recente evidence-rij van een bepaald type, of null. */
function laatsteVanType (evidence, type) {
  const rijen = evidence
    .filter((e) => e.type === type)
    .sort((a, b) => new Date(b.opgehaald_op) - new Date(a.opgehaald_op))
  return rijen[0] ?? null
}

/**
 * Berekent de beoordeling voor één vestiging.
 *
 * @param {object} opties
 * @param {object} opties.establishment - moet minstens bevatten:
 *   adres_gevalideerd (bool), is_vme (bool), is_domicilieadres_verdacht (bool),
 *   ar_straat (string|null) — aanwezigheid van ar_straat onderscheidt "AR
 *   spreekt het KBO-adres tegen" van "AR heeft dit adres nooit gecontroleerd".
 * @param {object|null} opties.enterprise - moet bevatten: is_gestopt (bool).
 *   null wordt behandeld als "onbekend", niet als "gestopt".
 * @param {Array<{type: string, waarde: string|null, ruwe_payload: object|null, opgehaald_op: string}>} opties.evidence
 * @param {{ bevestigd: boolean, reden: string }|null} [opties.domicilieBevestiging] -
 *   resultaat van bepaalDomicilieBevestiging() (domicilie.js), enkel relevant
 *   als establishment.is_domicilieadres_verdacht true is.
 *
 * @returns {object} - bij is_vme: { uitgesloten_reden: 'gebouwbeheer_vme' }.
 *   Anders: { zekerheid, zekerheid_percentage, redenen, voorgestelde_status,
 *   voorstel_tekst, uitgesloten_reden: null, score, domicilieadres_bevestigd }.
 *   zekerheid_percentage is de kans (5-95) dat de zaak echt actief is;
 *   zekerheid is diezelfde waarde als band Hoog/Middel/Laag.
 */
export function berekenBeoordeling ({ establishment, enterprise, evidence, domicilieBevestiging = null }) {
  // Speciaal geval 1: VME's zijn gebouwbeheer, geen bedrijf. Geen beoordeling
  // — de aanroeper mag op basis van uitgesloten_reden beslissen niets weg te
  // schrijven naar `beoordelingen`.
  if (establishment.is_vme) {
    return { uitgesloten_reden: 'gebouwbeheer_vme', zekerheid: null, zekerheid_percentage: null, redenen: null, voorgestelde_status: null, voorstel_tekst: null, score: null, domicilieadres_bevestigd: null }
  }

  const statusEvidence = laatsteVanType(evidence, 'status')
  const websiteEvidence = laatsteVanType(evidence, 'website')
  const reviewsEvidence = laatsteVanType(evidence, 'reviews_samenvatting')
  const geenMatchEvidence = laatsteVanType(evidence, 'geen_match_gevonden')

  const businessStatus = statusEvidence?.waarde ?? null
  const userRatingCount = reviewsEvidence?.ruwe_payload?.userRatingCount ?? null
  const isGestopt = enterprise?.is_gestopt === true
  // ar_straat gevuld MAAR adres_gevalideerd false = het adressenregister
  // spreekt het KBO-adres tegen (sterk signaal). ar_straat leeg = nooit
  // gecontroleerd (zwakker, geen tegenspraak, gewoon geen data).
  const arSprektTegen = Boolean(establishment.ar_straat) && !establishment.adres_gevalideerd

  const redenen = []
  let score = 0

  // --- de 8 kernregels uit de opdracht, elk +1/-1, elk met een reden -------
  if (businessStatus === 'OPERATIONAL') {
    score += 1
    redenen.push('+ Google Places meldt businessStatus OPERATIONAL')
  }
  if (websiteEvidence) {
    score += 1
    redenen.push(`+ website gevonden (${websiteEvidence.waarde})`)
  }
  if (userRatingCount !== null && userRatingCount > 0) {
    score += 1
    redenen.push(`+ ${userRatingCount} Google-reviews gevonden`)
  }
  if (establishment.adres_gevalideerd) {
    score += 1
    redenen.push('+ adres gevalideerd door het Vlaamse Adressenregister')
  }
  if (businessStatus === 'CLOSED_PERMANENTLY' || businessStatus === 'CLOSED_TEMPORARILY') {
    score -= 1
    redenen.push(`- Google Places meldt businessStatus ${businessStatus}`)
  }
  if (geenMatchEvidence) {
    score -= 1
    redenen.push(`- geen enkele match gevonden in Google Places (${geenMatchEvidence.waarde})`)
  }
  if (!establishment.adres_gevalideerd) {
    score -= 1
    redenen.push('- adres NIET gevalideerd door het Vlaamse Adressenregister')
  }
  if (isGestopt) {
    score -= 1
    redenen.push('- onderneming staat in het KBO geregistreerd als stopgezet')
  }

  // --- extra signaal, niet in de kernlijst van 8 maar expliciet gevraagd
  // onder "speciale gevallen": een BEVESTIGD domicilieadres (sterk
  // uiteenlopende activiteiten) is een negatief signaal; een adres dat wél
  // verdacht was maar NIET bevestigd wordt (bv. een kantorenpark met één
  // dominante sector) is transparantie-informatie, geen strafpunt.
  if (establishment.is_domicilieadres_verdacht && domicilieBevestiging) {
    if (domicilieBevestiging.bevestigd) {
      score -= 1
      redenen.push(`- gedeeld adres bevestigd als vermoedelijk brievenbusadres: ${domicilieBevestiging.reden}`)
    } else {
      redenen.push(`(adres deelt >15 registraties, maar NIET bevestigd als brievenbusadres: ${domicilieBevestiging.reden})`)
    }
  }

  if (evidence.length === 0) {
    redenen.push('- geen Google Places-gegevens beschikbaar (nog niet gecontroleerd)')
  }

  // --- zekerheid: van opgetelde score naar percentage -----------------------
  // De score blijft de kern: elk signaal is +1 of -1 en staat als leesbare
  // regel in `redenen`. percentageVanScore() is enkel een vaste, monotone
  // omzetting van diezelfde score naar een kans dat de zaak echt actief is,
  // zodat de ambtenaar "83%" ziet in plaats van alleen "Hoog". Geen extra
  // logica en geen verborgen weging: dezelfde score geeft altijd hetzelfde
  // percentage, en met de redenenlijst erbij is dat percentage na te rekenen.
  //
  // De band Hoog/Middel/Laag blijft bestaan (kleuren, filters, sortering) maar
  // wordt nu afgeleid van het percentage — met exact dezelfde drempels als
  // voorheen: score >= 2 → >= 70% → Hoog, score 0..1 → 40..69% → Middel,
  // score < 0 → < 40% → Laag.
  const zekerheidPercentage = percentageVanScore(score)
  const zekerheid = bandVanPercentage(zekerheidPercentage)

  // --- voorgestelde status: gerichte logica, los van de score --------------
  // Zekerheid ("hoe zeker zijn we") en voorgestelde_status ("wat denken we
  // dat er aan de hand is") zijn bewust twee aparte vragen: bv. "Google
  // bevestigt OPERATIONAL, maar het KBO zegt gestopt" is een tegenstrijdig
  // geval (score kan Middel zijn) waarvoor toch een heel specifiek voorstel
  // hoort ("waarschijnlijk_actief"), niet een vage "onzeker".
  let voorgesteldeStatus
  if (businessStatus === 'CLOSED_PERMANENTLY') {
    voorgesteldeStatus = 'waarschijnlijk_inactief'
  } else if (businessStatus === 'CLOSED_TEMPORARILY') {
    voorgesteldeStatus = 'onzeker' // tijdelijk gesloten kan later heropenen
  } else if (businessStatus === 'OPERATIONAL' && isGestopt) {
    voorgesteldeStatus = 'waarschijnlijk_actief' // conflict: bewijs vs. register
  } else if (businessStatus === 'OPERATIONAL' && arSprektTegen) {
    voorgesteldeStatus = 'kbo_niet_op_adres' // iets is hier open, maar het geregistreerde adres klopt niet
  } else if (businessStatus === 'OPERATIONAL') {
    voorgesteldeStatus = establishment.adres_gevalideerd ? 'actief' : 'waarschijnlijk_actief'
  } else if (geenMatchEvidence && arSprektTegen) {
    voorgesteldeStatus = 'kbo_niet_op_adres'
  } else if (geenMatchEvidence && (isGestopt || !establishment.adres_gevalideerd)) {
    voorgesteldeStatus = 'waarschijnlijk_inactief'
  } else if (geenMatchEvidence) {
    voorgesteldeStatus = 'onzeker' // adres is in orde, register zegt actief, gewoon niets online gevonden
  } else {
    voorgesteldeStatus = 'onzeker' // nog geen Places-gegevens
  }

  return {
    uitgesloten_reden: null,
    zekerheid,
    zekerheid_percentage: zekerheidPercentage,
    redenen,
    voorgestelde_status: voorgesteldeStatus,
    voorstel_tekst: null,
    score,
    domicilieadres_bevestigd: domicilieBevestiging?.bevestigd ?? null
  }
}
