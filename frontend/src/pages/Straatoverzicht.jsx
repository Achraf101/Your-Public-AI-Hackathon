import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import StraatKiezer from '../components/StraatKiezer'
import ZekerheidBadge from '../components/ZekerheidBadge'
import StatusBadge from '../components/StatusBadge'
import { useStraatData } from '../useStraatData'
import { splitsRedenen, formatteerDatum, formatteerAdres } from '../labels'

/** Wat het REGISTER en het BEWIJS zeggen — uit de beoordeling als die er is, anders uit de ruwe registervelden. */
function registerEnBewijs (v) {
  if (v.beoordeling?.redenen) return splitsRedenen(v.beoordeling.redenen)
  const register = [
    v.adres_gevalideerd ? 'Adres gevalideerd' : 'Adres NIET gevalideerd',
    v.enterprise_is_gestopt ? 'Onderneming stopgezet in KBO' : 'Onderneming actief in KBO'
  ].join('; ')
  return { register, bewijs: 'Nog niet gecontroleerd' }
}

function VestigingRij ({ v, navigate, ingesprongen }) {
  const { register, bewijs } = registerEnBewijs(v)
  return (
    <tr className={ingesprongen ? 'tabel-rij--lid' : 'tabel-rij--klikbaar'} onClick={() => navigate(`/vestiging/${v.vestiging_id}`)}>
      <td>{formatteerAdres(v.adres)}</td>
      <td>
        {v.naam ?? v.vestiging_id}
        {v.is_maatschappelijke_zetel && <span className="tag-klein"> (zetel)</span>}
      </td>
      <td>{register}</td>
      <td>{bewijs}</td>
      <td>{v.beoordeling ? formatteerDatum(v.beoordeling.aangemaakt_op) : 'Nog niet gecontroleerd'}</td>
      <td>
        <ZekerheidBadge
          percentage={v.beoordeling?.zekerheid_percentage}
          zekerheid={v.beoordeling?.zekerheid}
        />
      </td>
      <td><StatusBadge status={v.beoordeling?.voorgestelde_status} /></td>
    </tr>
  )
}

function DomicilieGroepRij ({ groep, navigate }) {
  const [open, setOpen] = useState(false)
  const uitleg = groep.domicilieadres_bevestigd
    ? `bevestigd als vermoedelijk brievenbusadres — ${groep.reden}`
    : `niet bevestigd als domicilieadres — ${groep.reden}`

  return (
    <>
      <tr className="tabel-rij--groep" onClick={() => setOpen((v) => !v)}>
        <td>{groep.straat} {groep.huisnr}</td>
        <td colSpan={6}>
          <strong>{groep.aantal} ondernemingen op dit adres</strong> — {uitleg}.{' '}
          <button type="button" className="knop-link">
            {open ? 'Verberg alle' : `Bekijk alle ${groep.aantal}`}
          </button>
        </td>
      </tr>
      {open && groep.leden.map((lid) => (
        <VestigingRij key={lid.vestiging_id} v={lid} navigate={navigate} ingesprongen />
      ))}
    </>
  )
}

export default function Straatoverzicht () {
  const [params, setParams] = useSearchParams()
  const gemeente = params.get('gemeente') ?? 'Schoten'
  const straat = params.get('straat') ?? 'Paalstraat'
  const navigate = useNavigate()
  const { data, laden, fout } = useStraatData(gemeente, straat)

  const samenvatting = useMemo(() => {
    if (!data) return null
    let actief = 0, onzeker = 0, mismatch = 0, ontbrekend = 0
    const iedereen = data.bedrijven.flatMap((b) => (b.type === 'vestiging' ? [b] : b.leden))
    for (const v of iedereen) {
      const s = v.beoordeling?.voorgestelde_status
      if (s === 'actief' || s === 'waarschijnlijk_actief') actief++
      else if (s === 'onzeker') onzeker++
      else if (s === 'waarschijnlijk_inactief' || s === 'kbo_niet_op_adres') mismatch++
      else if (s === 'mogelijk_ontbrekend') ontbrekend++
    }
    return { totaal: data.aantal_establishments, actief, onzeker, mismatch, ontbrekend, vmeUitgesloten: data.uitgesloten.length }
  }, [data])

  return (
    <div className="pagina">
      <h1>Analyseer straat</h1>
      <p className="pagina-intro">
        Alle vestigingen van één straat naast elkaar, met register en publiek bewijs.
        Gebouwbeheer (VME) wordt hier volledig weggelaten; verdachte domicilieadressen
        worden samengevouwen tot één uitklapbare rij.
      </p>

      <StraatKiezer gemeente={gemeente} straat={straat} onWijzig={({ gemeente, straat }) => setParams({ gemeente, straat })} />

      {laden && <p>Bezig met laden…</p>}
      {fout && <p className="foutmelding">Kon de gegevens niet ophalen: {fout.message}</p>}

      {data && samenvatting && (
        <>
          <div className="samenvatting-rij">
            <span><strong>{samenvatting.totaal}</strong> records</span>
            <span><strong>{samenvatting.actief}</strong> actief</span>
            <span><strong>{samenvatting.onzeker}</strong> onzeker</span>
            <span><strong>{samenvatting.mismatch}</strong> mogelijk mismatch met register</span>
            <span><strong>{samenvatting.ontbrekend}</strong> mogelijk ontbrekend</span>
            <span className="samenvatting-rij__zijnoot">{samenvatting.vmeUitgesloten} VME-records niet getoond</span>
          </div>

          <div className="tabel-wrapper">
            <table className="tabel">
              <thead>
                <tr>
                  <th>Adres</th>
                  <th>Onderneming/vestiging</th>
                  <th>Register</th>
                  <th>Bewijs van activiteit</th>
                  <th>Laatste waarneming</th>
                  <th title="Kans dat deze zaak echt actief is op dit adres">Kans actief</th>
                  <th>Voorstel</th>
                </tr>
              </thead>
              <tbody>
                {data.bedrijven.length === 0 && (
                  <tr><td colSpan={7} className="leeg-bericht">Geen vestigingen gevonden voor deze straat.</td></tr>
                )}
                {data.bedrijven.map((b) =>
                  b.type === 'vestiging'
                    ? <VestigingRij key={b.vestiging_id} v={b} navigate={navigate} />
                    : <DomicilieGroepRij key={`${b.straat}-${b.huisnr}`} groep={b} navigate={navigate} />
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
