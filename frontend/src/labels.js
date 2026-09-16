// ============================================================================
// Gedeelde vertalingen/kleuren — één plek, zodat "Hoog" overal dezelfde kleur
// krijgt en elke voorgestelde_status overal dezelfde Nederlandse tekst.
// ============================================================================

// Dezelfde drempels als in scripts/lib/confidence-engine.js. Het percentage is
// leidend; de band bestaat alleen nog om er een kleur en een woord aan te
// hangen.
export const ZEKERHEID_DREMPEL_HOOG = 70
export const ZEKERHEID_DREMPEL_MIDDEL = 40

export const ZEKERHEID_KLEUR = {
  Hoog: { tekst: '#1b5e20', achtergrond: '#e6f4ea', rand: '#a8d5b5' },
  Middel: { tekst: '#8a5a00', achtergrond: '#fdf1d6', rand: '#e7c682' },
  Laag: { tekst: '#8e2018', achtergrond: '#fbe9e7', rand: '#e3a89f' }
}

// Kleuren voor kaartmarkers — dezelfde semantiek als hierboven, als hex voor Leaflet.
export const ZEKERHEID_MARKERKLEUR = {
  Hoog: '#2e7d32',
  Middel: '#b8860b',
  Laag: '#c62828'
}

/** Percentage -> Hoog/Middel/Laag. Spiegelt bandVanPercentage() in de engine. */
export function bandVanPercentage (percentage) {
  if (percentage == null) return null
  if (percentage >= ZEKERHEID_DREMPEL_HOOG) return 'Hoog'
  if (percentage >= ZEKERHEID_DREMPEL_MIDDEL) return 'Middel'
  return 'Laag'
}

/**
 * De band van een beoordeling, met het percentage als bron van waarheid.
 * Valt terug op het opgeslagen `zekerheid`-veld voor oudere rijen die nog geen
 * percentage hebben.
 */
export function bandVanBeoordeling (beoordeling) {
  if (!beoordeling) return null
  return bandVanPercentage(beoordeling.zekerheid_percentage) ?? beoordeling.zekerheid ?? null
}

/**
 * Sorteersleutel: hoe lager, hoe dringender. Beoordelingen met een percentage
 * gebruiken dat getal; wie er nog geen heeft valt terug op het midden van zijn
 * band, en wie helemaal niet beoordeeld is komt vooraan (-1) want dat is per
 * definitie het meest onbekende geval.
 */
export const BAND_MIDDEN = { Laag: 17, Middel: 50, Hoog: 83 }

export function zekerheidSorteersleutel (beoordeling) {
  if (!beoordeling) return -1
  if (typeof beoordeling.zekerheid_percentage === 'number') return beoordeling.zekerheid_percentage
  return BAND_MIDDEN[beoordeling.zekerheid] ?? -1
}

/** "83%" of "—" als er nog geen beoordeling is. */
export function formatteerPercentage (percentage) {
  return typeof percentage === 'number' ? `${percentage}%` : '—'
}

export const STATUS_LABEL = {
  actief: 'Actief',
  waarschijnlijk_actief: 'Waarschijnlijk actief',
  onzeker: 'Onzeker',
  waarschijnlijk_inactief: 'Waarschijnlijk inactief',
  mogelijk_ontbrekend: 'Mogelijk ontbrekend in KBO',
  kbo_niet_op_adres: 'KBO niet op dit adres'
}

export const BEOORDELING_STATUS_LABEL = {
  te_controleren: 'Te controleren',
  bevestigd: 'Bevestigd',
  afgewezen: 'Afgewezen'
}

export const EVIDENCE_TYPE_LABEL = {
  status: 'Status bij Google Places',
  telefoon: 'Telefoonnummer gevonden',
  website: 'Website gevonden',
  uren: 'Openingsuren gevonden',
  reviews_samenvatting: 'Reviews op Google',
  geen_match_gevonden: 'Geen match gevonden'
}

/** Herleesbare samenvatting van één evidence-rij voor de tijdlijn. */
export function evidenceWaarneming (rij) {
  switch (rij.type) {
    case 'status':
      return `Google Places meldt status: ${rij.waarde}`
    case 'telefoon':
      return `Telefoonnummer gevonden: ${rij.waarde}`
    case 'website':
      return `Website gevonden: ${rij.waarde}`
    case 'uren':
      return 'Openingsuren gevonden op Google Places'
    case 'reviews_samenvatting':
      return `Reviews op Google: ${rij.waarde}`
    case 'geen_match_gevonden':
      return `Geen match gevonden: ${rij.waarde}`
    default:
      return rij.waarde ?? EVIDENCE_TYPE_LABEL[rij.type] ?? rij.type
  }
}

/** "Live" voor automatisch opgehaalde bronnen, "Handmatig" voor de rest. */
export function bronBadgeType (bron) {
  if (bron === 'demo_mock') return 'demo'
  return bron === 'google_places' || bron === 'vkbo' ? 'live' : 'handmatig'
}

export function formatteerDatum (iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

/**
 * Vat de redenen van een beoordeling samen tot twee korte kolomteksten voor
 * de straatoverzicht-tabel: wat het REGISTER zegt (KBO-status, adres) en wat
 * het publiek BEWIJS zegt (Google Places-signalen). De confidence-engine
 * bewaart elk signaal al als losse, leesbare reden (zie backend); dit is
 * enkel een client-side indeling van diezelfde tekst, geen nieuwe logica.
 */
export function splitsRedenen (redenen) {
  if (!redenen || redenen.length === 0) {
    return { register: 'Geen registergegevens', bewijs: 'Nog niet gecontroleerd' }
  }
  const registerTrefwoorden = ['adres', 'stopgezet', 'brievenbusadres', 'domicilie']
  const registerRegels = []
  const bewijsRegels = []
  for (const regel of redenen) {
    const isRegisterRegel = registerTrefwoorden.some((w) => regel.toLowerCase().includes(w))
    ;(isRegisterRegel ? registerRegels : bewijsRegels).push(regel.replace(/^[+-]\s*/, ''))
  }
  return {
    register: registerRegels.length > 0 ? registerRegels.join('; ') : 'Geen bijzonderheden',
    bewijs: bewijsRegels.length > 0 ? bewijsRegels.join('; ') : 'Geen Google Places-gegevens'
  }
}

export function formatteerAdres (adres) {
  if (!adres) return '—'
  const straatHuis = [adres.straat, adres.huisnr].filter(Boolean).join(' ')
  const postGem = [adres.postcode, adres.gemeente].filter(Boolean).join(' ')
  return [straatHuis, postGem].filter(Boolean).join(', ') || '—'
}
