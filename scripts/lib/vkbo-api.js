// ============================================================================
// Client voor de VKBO live API (Digitaal Vlaanderen, OGC API Features).
// Gratis, geen key nodig. Zie:
// https://geo.api.vlaanderen.be/VKBO/ogc/features/v1/collections/Vkbo/items
// ============================================================================

const BASIS_URL = 'https://geo.api.vlaanderen.be/VKBO/ogc/features/v1/collections/Vkbo/items'

// Eén request haalt maximaal deze hoeveelheid rijen op; de API pagineert via
// een "next"-link in de respons (zie haalAlleFeatures).
const STANDAARD_LIMIET = 100

// Harde bovengrens op het aantal pagina's, puur als vangnet tegen een
// oneindige lus als de API ooit een "next"-link blijft teruggeven op een lege
// pagina. 200 pagina's x 100 rijen = 20.000 rijen, ruim boven wat één straat
// of gemeente ooit zou bevatten.
const MAX_PAGINAS = 200

// Escaped een waarde voor gebruik in een CQL2-tekstliteral: enkel aanhalings-
// teken verdubbelen, zoals in SQL.
function cql2Waarde (waarde) {
  return `'${String(waarde).replace(/'/g, "''")}'`
}

/**
 * Bouwt de CQL2-filterstring, bv. KBO_Gemeente='Schoten' AND KBO_Straat='Paalstraat'.
 * straat is optioneel: zonder straat wordt de hele gemeente bevraagd.
 */
export function bouwFilter ({ gemeente, straat }) {
  const delen = [`KBO_Gemeente=${cql2Waarde(gemeente)}`]
  if (straat) delen.push(`KBO_Straat=${cql2Waarde(straat)}`)
  return delen.join(' AND ')
}

/** Bouwt de volledige request-URL voor de eerste pagina. */
export function bouwUrl ({ gemeente, straat, limiet = STANDAARD_LIMIET }) {
  const params = new URLSearchParams({
    f: 'application/json',
    limit: String(limiet),
    filter: bouwFilter({ gemeente, straat }),
    'filter-lang': 'cql2-text'
  })
  return `${BASIS_URL}?${params.toString()}`
}

/**
 * Haalt alle GeoJSON-features op voor een gemeente (+ optioneel straat),
 * en volgt daarbij zelf de "next"-link in de respons totdat een pagina leeg
 * is of er geen next-link meer is. De API geeft geen betrouwbaar totaal
 * (totalFeatures kan "unknown" zijn), dus vertrouwen we niet op dat veld.
 *
 * @param {object} opties
 * @param {string} opties.gemeente
 * @param {string} [opties.straat]
 * @param {number} [opties.limiet]
 * @param {typeof fetch} [opties.fetchImpl] - injecteerbaar voor tests.
 * @returns {Promise<Array<{properties: object, geometry: object|null}>>}
 */
export async function haalAlleFeatures ({ gemeente, straat, limiet = STANDAARD_LIMIET, fetchImpl = fetch }) {
  const resultaten = []
  let url = bouwUrl({ gemeente, straat, limiet })
  let pagina = 0

  while (url && pagina < MAX_PAGINAS) {
    const respons = await fetchImpl(url)
    if (!respons.ok) {
      throw new Error(`VKBO-API antwoordde met status ${respons.status} voor ${url}`)
    }
    const data = await respons.json()
    const features = data.features ?? []
    resultaten.push(...features)
    pagina++

    if (features.length === 0) break
    const next = (data.links ?? []).find((l) => l.rel === 'next')
    url = next ? next.href : null
  }

  return resultaten
}
