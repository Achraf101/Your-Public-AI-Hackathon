import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import ZekerheidBadge from '../components/ZekerheidBadge'
import StatusBadge from '../components/StatusBadge'
import BevestigAfwijsKnoppen from '../components/BevestigAfwijsKnoppen'
import { formatteerAdres, splitsRedenen, zekerheidSorteersleutel } from '../labels'

export default function TeControleren () {
  const [beoordelingen, setBeoordelingen] = useState(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState(null)

  useEffect(() => {
    setLaden(true)
    api.haalTeControleren()
      .then((d) => setBeoordelingen(d.beoordelingen))
      .catch(setFout)
      .finally(() => setLaden(false))
  }, [])

  function verwijderUitLijst (id) {
    // Zodra bevestigd/afgewezen hoort een voorstel niet meer in deze
    // review-queue thuis — meteen uit de lijst halen, geen herlaad nodig.
    setBeoordelingen((lijst) => lijst.filter((b) => b.id !== id))
  }

  // Laagste kans eerst — op het percentage zelf, zodat 8% vóór 31% komt en niet
  // allebei ergens in de hoop "Laag" verdwijnt.
  const gesorteerd = beoordelingen
    ? [...beoordelingen].sort((a, b) => zekerheidSorteersleutel(a) - zekerheidSorteersleutel(b))
    : []

  return (
    <div className="pagina">
      <h1>Te controleren</h1>
      <p className="pagina-intro">
        Alle openstaande voorstellen, laagste kans op een actieve zaak eerst — dit is waar je
        als eerste naar moet kijken.
      </p>

      {laden && <p>Bezig met laden…</p>}
      {fout && <p className="foutmelding">Kon de review-queue niet ophalen: {fout.message}</p>}
      {beoordelingen && gesorteerd.length === 0 && <p className="leeg-bericht">Geen openstaande voorstellen. 🎉</p>}

      <ul className="review-lijst" hidden={gesorteerd.length === 0}>
        {gesorteerd.map((b) => {
          const { register, bewijs } = splitsRedenen(b.redenen)
          return (
            <li key={b.id} className="review-kaart">
              <div className="review-kaart__kop">
                <div>
                  <Link to={b.establishment_id ? `/vestiging/${b.establishment_id}` : '#'} className="review-kaart__naam">
                    {b.naam ?? b.voorstel_tekst ?? 'Onbekende zaak'}
                  </Link>
                  <div className="review-kaart__adres">{b.adres ? formatteerAdres(b.adres) : b.voorstel_tekst}</div>
                </div>
                <div className="review-kaart__badges">
                  <ZekerheidBadge percentage={b.zekerheid_percentage} zekerheid={b.zekerheid} />
                  <StatusBadge status={b.voorgestelde_status} />
                </div>
              </div>
              <p className="review-kaart__samenvatting">
                <strong>Register:</strong> {register} · <strong>Bewijs:</strong> {bewijs}
              </p>
              <BevestigAfwijsKnoppen
                beoordeling={b}
                weergave="compact"
                onBijgewerkt={() => verwijderUitLijst(b.id)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
