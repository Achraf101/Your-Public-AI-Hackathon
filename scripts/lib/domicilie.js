// ============================================================================
// Domicilieadres-BEVESTIGING: onderscheidt een echt brievenbusadres van een
// gewoon bedrijvengebouw waar toevallig veel bedrijven uit dezelfde sector
// zitten (bv. een kantorenpark voor vastgoedkantoren).
// ----------------------------------------------------------------------------
// is_domicilieadres_verdacht (prompt 2) is enkel een registersignaal: meer dan
// 15 inschrijvingen op hetzelfde huisnummer. Dat signaal alleen is niet
// genoeg — zie het echte voorbeeld hieronder. Deze module voegt de
// activiteitsvergelijking toe die de opdracht vraagt: pas als de NACE-
// activiteiten van die vestigingen sterk uiteenlopen, bevestigen we het
// vermoeden.
//
// Getest tegen een echt geval: Paalstraat 70, Schoten heeft 25 geregistreerde
// vastgoed-vennootschappen (IMMOBOR, IMMOHAN, DIMMO, ...). Zonder NACE-check
// zou dit een "bevestigd brievenbusadres" lijken. Met de NACE-check blijkt
// bijna elke vestiging in dezelfde sector te zitten (NACE-afdeling 68 —
// vastgoed) — dit is een kantorenpark voor vastgoedkantoren, geen
// brievenbusadres. Zie README voor de volledige uitkomst.
// ============================================================================

/**
 * De bruikbare NACE-afdeling van één vestiging: eigen NACE_RSZ als die er is
 * (spaarzaam ingevuld, zie migratie), anders de NACE_BTW van de
 * moederonderneming. Retourneert null als geen van beide bekend is — zo'n
 * vestiging telt niet mee in de diversiteitsberekening (onbekend is geen
 * signaal, noch voor, noch tegen).
 */
export function activiteitAfdeling (vestiging) {
  return vestiging.nace_afdeling_rsz ?? vestiging.nace_afdeling_btw ?? null
}

/**
 * Bepaalt of een verdacht adres (>15 inschrijvingen, is_domicilieadres_verdacht)
 * bevestigd wordt als vermoedelijk brievenbusadres, op basis van hoe divers de
 * NACE-activiteiten van de vestigingen daar zijn.
 *
 * Regel (bewust simpel en uitlegbaar — zie ook de zekerheid-regel: geen
 * black box):
 *  - Te weinig bekende NACE-codes (minder dan 2) -> onvoldoende data, NIET
 *    bevestigen. Dat is geen "nee", het is "we weten het niet".
 *  - 2+ bekende NACE-afdelingen, en de grootste afdeling beslaat MEER dan de
 *    helft van de bekende codes -> één sector domineert (zoals het
 *    vastgoedkantoor-voorbeeld) -> NIET bevestigen.
 *  - Anders (activiteiten liggen echt door elkaar, geen enkele sector
 *    domineert) -> WEL bevestigen.
 *
 * @param {Array<{ nace_afdeling_rsz?: string|null, nace_afdeling_btw?: string|null }>} vestigingenOpAdres
 * @returns {{ bevestigd: boolean, reden: string, aantalBekend: number, afdelingen: Record<string, number> }}
 */
export function bepaalDomicilieBevestiging (vestigingenOpAdres) {
  const afdelingen = {}
  for (const v of vestigingenOpAdres) {
    const afd = activiteitAfdeling(v)
    if (!afd) continue
    afdelingen[afd] = (afdelingen[afd] ?? 0) + 1
  }

  const aantalBekend = Object.values(afdelingen).reduce((a, b) => a + b, 0)
  const aantalAfdelingen = Object.keys(afdelingen).length

  if (aantalBekend < 2) {
    return {
      bevestigd: false,
      reden: `te weinig bekende NACE-codes (${aantalBekend} van ${vestigingenOpAdres.length}) om activiteiten te vergelijken`,
      aantalBekend,
      afdelingen
    }
  }

  const grootsteAantal = Math.max(...Object.values(afdelingen))
  const grootsteAandeel = grootsteAantal / aantalBekend

  if (aantalAfdelingen < 2 || grootsteAandeel > 0.5) {
    const [dominanteAfdeling] = Object.entries(afdelingen).sort((a, b) => b[1] - a[1])[0]
    return {
      bevestigd: false,
      reden: `activiteiten liggen dicht bij elkaar — NACE-afdeling ${dominanteAfdeling} domineert (${grootsteAantal} van ${aantalBekend} bekende codes), vermoedelijk een legitiem bedrijvengebouw`,
      aantalBekend,
      afdelingen
    }
  }

  return {
    bevestigd: true,
    reden: `sterk uiteenlopende activiteiten (${aantalAfdelingen} verschillende NACE-afdelingen onder ${aantalBekend} bekende codes, geen enkele domineert), mogelijk een brievenbusadres`,
    aantalBekend,
    afdelingen
  }
}

/**
 * Groepeert de vestigingen van een straat per adres. Verdachte adressen
 * (is_domicilieadres_verdacht) worden samengevouwen tot één groepsentry met
 * de NACE-bevestiging erbij; alle andere vestigingen blijven losse entries.
 *
 * @param {Array<object>} vestigingen - rijen met minstens straat, huisnr,
 *   is_domicilieadres_verdacht, nace_afdeling_rsz, nace_afdeling_btw.
 * @returns {Array<object>} lijst van { type: 'vestiging', ... } en
 *   { type: 'domicilie_groep', ... , leden: [...] } entries.
 */
export function groepeerPerAdres (vestigingen) {
  const resultaat = []
  const verdachtPerAdres = new Map()

  for (const v of vestigingen) {
    if (!v.is_domicilieadres_verdacht) {
      resultaat.push({ type: 'vestiging', ...v })
      continue
    }
    const sleutel = `${v.straat ?? ''}|${v.huisnr ?? ''}`
    if (!verdachtPerAdres.has(sleutel)) verdachtPerAdres.set(sleutel, [])
    verdachtPerAdres.get(sleutel).push(v)
  }

  for (const [, leden] of verdachtPerAdres) {
    const { bevestigd, reden, aantalBekend, afdelingen } = bepaalDomicilieBevestiging(leden)
    resultaat.push({
      type: 'domicilie_groep',
      straat: leden[0].straat,
      huisnr: leden[0].huisnr,
      aantal: leden.length,
      domicilieadres_bevestigd: bevestigd,
      reden,
      nace_afdelingen_bekend: aantalBekend,
      nace_afdelingen: afdelingen,
      leden
    })
  }

  return resultaat
}
