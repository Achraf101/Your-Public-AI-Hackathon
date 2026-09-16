// ============================================================================
// Dunne client voor Places API (New). Twee calls, elk met een zo krap
// mogelijke FieldMask.
// ----------------------------------------------------------------------------
// Google rekent per request af volgens de DUURSTE SKU-laag van de opgevraagde
// velden (Essentials < Pro < Enterprise < Enterprise+Atmosphere), niet per
// veld. Dat stuurt de opsplitsing in twee calls:
//
//   Text Search  -> enkel om te MATCHEN: id (Essentials) + displayName +
//                   formattedAddress (Pro). Nooit de dure velden hier
//                   opvragen, want elk kandidaat-resultaat in de zoekopdracht
//                   zou dan meebetalen aan het Enterprise-tarief.
//   Place Details -> pas voor de ÉÉN bevestigde match: alle 8 gevraagde
//                    velden. nationalPhoneNumber/websiteUri/
//                    currentOpeningHours/rating/userRatingCount zitten in de
//                    Enterprise-laag; dat bepaalt sowieso al de prijs van deze
//                    call. id en googleMapsUri zijn erbij genomen (nodig om te
//                    chainen en voor bron_url) maar zitten in een lagere laag
//                    (Essentials/Pro) en verhogen de kost dus NIET boven wat
//                    er toch al voor de Enterprise-velden betaald wordt.
//
// Bronnen (nagekeken via de officiële docs op 2026-09-16):
//   https://developers.google.com/maps/documentation/places/web-service/text-search
//   https://developers.google.com/maps/documentation/places/web-service/place-details
// Belangrijk verschil tussen de twee endpoints: Text Search geeft een LIJST
// terug (places[]), dus FieldMask-paden krijgen daar een "places."-prefix.
// Place Details geeft één object terug, dus daar GEEN prefix.
// ============================================================================

const BASIS_URL = 'https://places.googleapis.com/v1'

const ZOEK_FIELDMASK = 'places.id,places.displayName,places.formattedAddress'

const DETAIL_FIELDMASK = [
  'id', 'displayName', 'formattedAddress', 'businessStatus',
  'nationalPhoneNumber', 'websiteUri', 'currentOpeningHours',
  'rating', 'userRatingCount', 'googleMapsUri'
].join(',')

/**
 * Text Search (New): POST /v1/places:searchText. Retourneert de ruwe
 * kandidatenlijst (meestal 0-5); de matchlogica in places-match.js bepaalt
 * of één daarvan betrouwbaar genoeg is om te gebruiken.
 *
 * @returns {Promise<Array<{id: string, displayName?: {text: string}, formattedAddress?: string}>>}
 */
export async function zoekPlaats ({ zoekterm, apiKey, fetchImpl = fetch }) {
  const resp = await fetchImpl(`${BASIS_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': ZOEK_FIELDMASK
    },
    body: JSON.stringify({
      textQuery: zoekterm,
      languageCode: 'nl',
      regionCode: 'BE',
      // We hebben maar een handvol resultaten nodig om te weten of de
      // zoekopdracht eenduidig is; meer opvragen kost niet meer (billing is
      // per call, niet per resultaat) maar vertraagt en vergroot de respons
      // onnodig.
      pageSize: 5
    })
  })
  if (!resp.ok) {
    throw new Error(`Places Text Search gaf status ${resp.status}: ${await resp.text()}`)
  }
  const data = await resp.json()
  return data.places ?? []
}

/**
 * Place Details (New): GET /v1/places/{placeId}. Wordt enkel aangeroepen
 * nadat kiesBesteMatch() (places-match.js) een eenduidige match heeft
 * gekozen — nooit voor elk zoekresultaat apart.
 */
export async function haalDetails ({ placeId, apiKey, fetchImpl = fetch }) {
  const resp = await fetchImpl(`${BASIS_URL}/places/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAIL_FIELDMASK
    }
  })
  if (!resp.ok) {
    throw new Error(`Places Details gaf status ${resp.status}: ${await resp.text()}`)
  }
  return resp.json()
}
