// ============================================================================
// Matchlogica: bepaalt of een Text Search-resultaat betrouwbaar genoeg is om
// automatisch te gebruiken. "Nooit gokken" (zie opdracht) betekent hier
// letterlijk: bij twijfel niets als match opslaan, wél opslaan als
// geen_match_gevonden mét de reden — nooit het eerste resultaat aannemen.
// ============================================================================

/** Kleine letters, geen accenten, geen leestekens — voor een ruwe vergelijking. */
function normaliseerNaam (s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function naamKomtOvereen (gezochteNaam, gevondenNaam) {
  const a = normaliseerNaam(gezochteNaam)
  const b = normaliseerNaam(gevondenNaam)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

function postcodeKomtOvereen (postcode, formattedAddress) {
  if (!postcode) return true // niets om tegen te toetsen: blokkeer hier niet op
  return (formattedAddress ?? '').includes(postcode)
}

/**
 * Kiest de beste match uit de Text Search-resultaten, of geeft null terug
 * met een leesbare reden als er geen betrouwbare keuze te maken is.
 *
 * Bewust een simpele, uitlegbare regel in plaats van een scoringsmodel —
 * dit is precies het soort automatische beslissing die "geen black box" mag
 * zijn (zie de zekerheid-regel uit het datamodel):
 *
 *   0 resultaten  -> geen match.
 *   2+ resultaten -> altijd geen match. De opdracht noemt "meerdere
 *                    gelijkaardige resultaten" expliciet als reden om niet te
 *                    gokken: met meerdere kandidaten weten we niet zeker
 *                    welke de juiste vestiging is.
 *   1 resultaat   -> enkel gebruiken als naam ÉN postcode aannemelijk
 *                    overeenkomen. Eén resultaat is geen garantie: Google's
 *                    tekstzoekopdracht geeft soms de dichtstbijzijnde
 *                    buurzaak terug als de exacte naam niet op Google Maps
 *                    staat (heel gewoon voor kleine eenmanszaken zonder
 *                    Google Bedrijfsprofiel).
 *
 * @returns {{ plaats: object|null, reden: string|null }}
 */
export function kiesBesteMatch (resultaten, { zoeknaam, postcode }) {
  if (resultaten.length === 0) {
    return { plaats: null, reden: 'geen resultaten in Google Places voor deze zoekopdracht' }
  }
  if (resultaten.length > 1) {
    return {
      plaats: null,
      reden: `meerdere gelijkaardige resultaten (${resultaten.length}), geen automatische keuze mogelijk`
    }
  }

  const [kandidaat] = resultaten
  const gevondenNaam = kandidaat.displayName?.text
  const overeenkomst = naamKomtOvereen(zoeknaam, gevondenNaam) && postcodeKomtOvereen(postcode, kandidaat.formattedAddress)

  if (!overeenkomst) {
    return {
      plaats: null,
      reden: `één resultaat, maar naam/adres komt onvoldoende overeen: "${gevondenNaam ?? '?'}" - ${kandidaat.formattedAddress ?? '?'}`
    }
  }

  return { plaats: kandidaat, reden: null }
}
