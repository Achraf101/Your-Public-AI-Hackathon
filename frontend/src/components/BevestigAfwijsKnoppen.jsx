import { useState } from 'react'
import { api } from '../api'
import { useBeoordelaar } from '../useBeoordelaar.jsx'

/**
 * Herbruikbaar knoppenpaar voor de bevestig/wijs-af-flow — zowel op de
 * detailpagina als inline in de review-queue.
 *
 * @param {object} beoordeling - moet minstens { id, status, beoordeeld_door, beoordeeld_op } bevatten.
 * @param {(bijgewerkt: object) => void} onBijgewerkt - callback met de
 *   bijgewerkte beoordeling, voor een directe UI-update zonder herlaad.
 * @param {'normaal'|'compact'} [weergave]
 */
export default function BevestigAfwijsKnoppen ({ beoordeling, onBijgewerkt, weergave = 'normaal' }) {
  const [naam, setNaam] = useBeoordelaar()
  const [bezig, setBezig] = useState(null) // 'bevestig' | 'wijs-af' | null
  const [foutmelding, setFoutmelding] = useState(null)

  if (!beoordeling) return null

  if (beoordeling.status !== 'te_controleren') {
    const label = beoordeling.status === 'bevestigd' ? 'bevestigd' : 'afgewezen'
    return (
      <p className="beslissing-resultaat">
        Voorstel <strong>{label}</strong> door <strong>{beoordeling.beoordeeld_door}</strong>
        {beoordeling.beoordeeld_op && ` op ${new Date(beoordeling.beoordeeld_op).toLocaleString('nl-BE')}`}.
      </p>
    )
  }

  async function verwerk (actie) {
    if (!naam.trim()) {
      setFoutmelding('Vul je naam in (rechtsboven) voor je een voorstel bevestigt of afwijst.')
      return
    }
    setFoutmelding(null)
    setBezig(actie)
    try {
      const resultaat = actie === 'bevestig'
        ? await api.bevestig(beoordeling.id, naam.trim())
        : await api.wijsAf(beoordeling.id, naam.trim())
      onBijgewerkt(resultaat.beoordeling)
    } catch (fout) {
      setFoutmelding(fout.body?.fout ?? fout.message)
    } finally {
      setBezig(null)
    }
  }

  return (
    <div className={`beslissing-blok beslissing-blok--${weergave}`}>
      <div className="beslissing-knoppen">
        <button type="button" className="knop knop--bevestig" disabled={Boolean(bezig)} onClick={() => verwerk('bevestig')}>
          {bezig === 'bevestig' ? 'Bezig…' : 'Bevestigen'}
        </button>
        <button type="button" className="knop knop--afwijs" disabled={Boolean(bezig)} onClick={() => verwerk('wijs-af')}>
          {bezig === 'wijs-af' ? 'Bezig…' : 'Afwijzen'}
        </button>
      </div>
      {weergave === 'normaal' && (
        <p className="beslissing-toelichting">
          Dit past enkel het <strong>voorstel in deze tool</strong> aan — het officiële
          KBO-register wordt hierdoor niet gewijzigd.
        </p>
      )}
      {foutmelding && <p className="foutmelding">{foutmelding}</p>}
    </div>
  )
}
