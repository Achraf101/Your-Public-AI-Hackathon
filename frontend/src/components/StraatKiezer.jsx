import { useEffect, useId, useState } from 'react'
import { api } from '../api'

/**
 * Gemeente en straat zijn allebei vrije invulvelden. De straten die we voor de
 * gekozen gemeente kennen komen mee als <datalist>-suggesties: typen filtert
 * de lijst, maar je bent er niet toe verplicht — een straat die nog niet in de
 * database zit kun je gewoon intypen en opzoeken.
 *
 * Bevestigen gebeurt bij Enter of bij het verlaten van het veld, niet bij elke
 * toetsaanslag: anders zou er een request vertrekken voor elke letter.
 */
export default function StraatKiezer ({ gemeente, straat, onWijzig }) {
  const [gemeenteInvoer, setGemeenteInvoer] = useState(gemeente)
  const [straatInvoer, setStraatInvoer] = useState(straat)
  const [straten, setStraten] = useState([])
  const [laden, setLaden] = useState(false)
  const stratenLijstId = useId()

  // De velden volgen de URL (bv. als je teruggaat in de browser), zolang je er
  // zelf niet in aan het typen bent.
  useEffect(() => { setGemeenteInvoer(gemeente) }, [gemeente])
  useEffect(() => { setStraatInvoer(straat) }, [straat])

  useEffect(() => {
    if (!gemeenteInvoer) return
    setLaden(true)
    api.haalStraten(gemeenteInvoer)
      .then((data) => setStraten(data.straten))
      .catch(() => setStraten([]))
      .finally(() => setLaden(false))
  }, [gemeenteInvoer])

  /** Stuurt de huidige invoer door; lege velden leveren nooit een zoekopdracht op. */
  function bevestig () {
    const nieuweGemeente = gemeenteInvoer.trim()
    const nieuweStraat = straatInvoer.trim()
    if (!nieuweGemeente || !nieuweStraat) return
    if (nieuweGemeente === gemeente && nieuweStraat === straat) return
    onWijzig({ gemeente: nieuweGemeente, straat: nieuweStraat })
  }

  function bijEnter (e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      bevestig()
    }
  }

  const bekendeStraat = straten.find(
    (s) => s.straat.toLowerCase() === straatInvoer.trim().toLowerCase()
  )

  return (
    <div className="straat-kiezer">
      <label className="veld">
        <span>Gemeente</span>
        <input
          type="text"
          value={gemeenteInvoer}
          onChange={(e) => setGemeenteInvoer(e.target.value)}
          onKeyDown={bijEnter}
          onBlur={bevestig}
          placeholder="bv. Schoten"
          autoComplete="off"
        />
      </label>
      <label className="veld">
        <span>Straat {laden && '(suggesties laden…)'}</span>
        <input
          type="text"
          list={stratenLijstId}
          value={straatInvoer}
          onChange={(e) => setStraatInvoer(e.target.value)}
          onKeyDown={bijEnter}
          onBlur={bevestig}
          placeholder="bv. Paalstraat"
          autoComplete="off"
        />
        <datalist id={stratenLijstId}>
          {straten.map((s) => (
            <option key={s.straat} value={s.straat}>{s.aantal_records} records</option>
          ))}
        </datalist>
        <span className="veld__hint">
          {bekendeStraat
            ? `${bekendeStraat.aantal_records} records in het register`
            : straten.length > 0
              ? `Typ vrij of kies uit ${straten.length} gekende straten`
              : 'Typ een straatnaam en druk op Enter'}
        </span>
      </label>
    </div>
  )
}
