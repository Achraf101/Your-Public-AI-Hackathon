import BronBadge from './BronBadge'
import { evidenceWaarneming, formatteerDatum } from '../labels'

/** Evidence-timeline: nieuwste bovenaan, één kaart per waarneming. */
export default function EvidenceTijdlijn ({ evidence }) {
  if (!evidence || evidence.length === 0) {
    return <p className="leeg-bericht">Nog geen publiek bewijs opgehaald voor deze vestiging.</p>
  }

  const nieuwsteEerst = [...evidence].sort((a, b) => new Date(b.opgehaald_op) - new Date(a.opgehaald_op))

  return (
    <ul className="evidence-tijdlijn">
      {nieuwsteEerst.map((rij) => (
        <li key={rij.id ?? `${rij.type}-${rij.opgehaald_op}`} className="evidence-kaart">
          <div className="evidence-kaart__kop">
            <span className="evidence-kaart__bron">{rij.bron}</span>
            <BronBadge bron={rij.bron} />
            <span className="evidence-kaart__datum">{formatteerDatum(rij.opgehaald_op)}</span>
          </div>
          <p className="evidence-kaart__waarneming">{evidenceWaarneming(rij)}</p>
          {rij.bron_url && (
            <a href={rij.bron_url} target="_blank" rel="noreferrer" className="evidence-kaart__link">
              Bron bekijken ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
