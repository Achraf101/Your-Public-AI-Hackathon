import { useEffect, useState } from 'react'
import { api } from '../api'

/** Gemeente (vrij invulveld) + straat (dropdown, gevuld via GET /straten/:gemeente). */
export default function StraatKiezer ({ gemeente, straat, onWijzig }) {
  const [gemeenteInvoer, setGemeenteInvoer] = useState(gemeente)
  const [straten, setStraten] = useState([])
  const [laden, setLaden] = useState(false)

  useEffect(() => { setGemeenteInvoer(gemeente) }, [gemeente])

  useEffect(() => {
    if (!gemeenteInvoer) return
    setLaden(true)
    api.haalStraten(gemeenteInvoer)
      .then((data) => setStraten(data.straten))
      .catch(() => setStraten([]))
      .finally(() => setLaden(false))
  }, [gemeenteInvoer])

  return (
    <div className="straat-kiezer">
      <label className="veld">
        <span>Gemeente</span>
        <input
          type="text"
          value={gemeenteInvoer}
          onChange={(e) => setGemeenteInvoer(e.target.value)}
          onBlur={() => onWijzig({ gemeente: gemeenteInvoer, straat })}
          placeholder="bv. Schoten"
        />
      </label>
      <label className="veld">
        <span>Straat {laden && '(laden…)'}</span>
        <select
          value={straat}
          onChange={(e) => onWijzig({ gemeente: gemeenteInvoer, straat: e.target.value })}
        >
          <option value="">— kies een straat —</option>
          {straten.map((s) => (
            <option key={s.straat} value={s.straat}>
              {s.straat} ({s.aantal_records})
            </option>
          ))}
          {straat && !straten.some((s) => s.straat === straat) && (
            <option value={straat}>{straat}</option>
          )}
        </select>
      </label>
    </div>
  )
}
