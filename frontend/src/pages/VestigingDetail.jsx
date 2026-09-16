import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import KaartWeergave from '../components/KaartWeergave'
import ZekerheidBadge from '../components/ZekerheidBadge'
import StatusBadge from '../components/StatusBadge'
import EvidenceTijdlijn from '../components/EvidenceTijdlijn'
import BevestigAfwijsKnoppen from '../components/BevestigAfwijsKnoppen'
import { formatteerAdres } from '../labels'

/** Telefoon/website: eerst op de vestiging zelf zoeken, anders bij de zetel — altijd zeggen welke van de twee het is. */
function vindContactgegeven (type, lokaalEvidence, zetelEvidence) {
  const lokaal = lokaalEvidence?.find((e) => e.type === type)
  if (lokaal) return { waarde: lokaal.waarde, bron: 'lokaal' }
  const centraal = zetelEvidence?.find((e) => e.type === type)
  if (centraal) return { waarde: centraal.waarde, bron: 'zetel' }
  return null
}

export default function VestigingDetail () {
  const { id } = useParams()
  const [detail, setDetail] = useState(null)
  const [zetelDetail, setZetelDetail] = useState(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState(null)
  const [herberekenBezig, setHerberekenBezig] = useState(false)

  const laadAlles = useCallback(async () => {
    setLaden(true)
    setFout(null)
    try {
      const d = await api.haalVestigingDetail(id)
      setDetail(d)
      if (!d.establishment.is_maatschappelijke_zetel) {
        try {
          setZetelDetail(await api.haalVestigingDetail(d.enterprise.id))
        } catch {
          setZetelDetail(null) // zetel nog niet apart opgehaald/ingeladen — geen fout, gewoon onbekend
        }
      } else {
        setZetelDetail(null)
      }
    } catch (e) {
      setFout(e)
    } finally {
      setLaden(false)
    }
  }, [id])

  useEffect(() => { laadAlles() }, [laadAlles])

  async function herbereken () {
    setHerberekenBezig(true)
    try {
      await api.herbereken(id)
      await laadAlles()
    } finally {
      setHerberekenBezig(false)
    }
  }

  if (laden) return <div className="pagina"><p>Bezig met laden…</p></div>
  if (fout) return <div className="pagina"><p className="foutmelding">Kon de vestiging niet ophalen: {fout.message}</p></div>
  if (!detail) return null

  const { enterprise, establishment, evidence, huidige_beoordeling: beoordeling } = detail
  const telefoon = vindContactgegeven('telefoon', evidence, zetelDetail?.evidence)
  const website = vindContactgegeven('website', evidence, zetelDetail?.evidence)
  const activiteit = establishment.nace_omschrijving_rsz
    ? { omschrijving: establishment.nace_omschrijving_rsz, code: establishment.nace_code_rsz, bron: 'lokaal (RSZ)' }
    : enterprise.nace_omschrijving_btw
      ? { omschrijving: enterprise.nace_omschrijving_btw, code: enterprise.nace_code_btw, bron: 'onderneming (BTW)' }
      : null

  return (
    <div className="pagina">
      <p className="broodkruimel"><Link to="/">← Terug naar dashboard</Link></p>

      <h1>{enterprise.handelsnaam ?? enterprise.naam ?? establishment.id}</h1>
      <p className="pagina-intro">
        Ondernemingsnummer <strong>{enterprise.id}</strong> ·{' '}
        {establishment.is_maatschappelijke_zetel ? 'Maatschappelijke zetel' : 'Vestigingseenheid'}
        {' '}(vestigingsnr. {establishment.id})
        {enterprise.is_placeholder && (
          <> — <em>onderneming nog niet volledig opgehaald (zetel ligt buiten de geanalyseerde straat/gemeente)</em></>
        )}
      </p>

      <section className="paneel">
        <h2>Adres: lokaal versus maatschappelijke zetel</h2>
        <div className="adres-vergelijking">
          <div>
            <h3>Lokaal adres (deze vestiging)</h3>
            <p>{formatteerAdres(establishment)}</p>
            <p className="klein-detail">
              {establishment.adres_gevalideerd
                ? '✓ gevalideerd door het Vlaamse Adressenregister'
                : '✗ NIET gevalideerd door het Vlaamse Adressenregister'}
            </p>
          </div>
          <div>
            <h3>Maatschappelijke zetel</h3>
            {establishment.is_maatschappelijke_zetel ? (
              <p className="klein-detail">Dit IS de zetel — zelfde adres als hierboven.</p>
            ) : zetelDetail ? (
              <p>{formatteerAdres(zetelDetail.establishment)}</p>
            ) : (
              <p className="klein-detail">Zetel-adres onbekend (nog niet opgehaald in dit systeem).</p>
            )}
          </div>
        </div>
      </section>

      <section className="paneel">
        <h2>KBO-status en activiteit</h2>
        <dl className="definitie-lijst">
          <dt>Rechtsvorm</dt><dd>{enterprise.rechtsvorm ?? '—'}</dd>
          <dt>Rechtstoestand</dt><dd>{enterprise.rechtstoestand ?? '—'}</dd>
          <dt>Stopgezet in KBO?</dt><dd>{enterprise.is_gestopt ? 'Ja' : 'Nee'}</dd>
          <dt>Activiteit (NACE)</dt>
          <dd>{activiteit ? `${activiteit.omschrijving} (${activiteit.code}, bron: ${activiteit.bron})` : 'Onbekend'}</dd>
        </dl>
      </section>

      <section className="paneel">
        <h2>Contactgegevens</h2>
        <dl className="definitie-lijst">
          <dt>Telefoon</dt>
          <dd>{telefoon ? `${telefoon.waarde} (${telefoon.bron === 'lokaal' ? 'lokaal' : 'centraal — zetel'})` : 'Contactgegevens onbekend'}</dd>
          <dt>Website</dt>
          <dd>{website ? <><a href={website.waarde} target="_blank" rel="noreferrer">{website.waarde}</a> {`(${website.bron === 'lokaal' ? 'lokaal' : 'centraal — zetel'})`}</> : 'Contactgegevens onbekend'}</dd>
        </dl>
      </section>

      <section className="paneel">
        <h2>Locatie</h2>
        <KaartWeergave
          punten={[{ id: establishment.id, lat: establishment.latitude, lng: establishment.longitude, naam: enterprise.naam, zekerheid: beoordeling?.zekerheid }]}
          hoogte={260}
        />
      </section>

      <section className="paneel">
        <h2>Zekerheid en voorstel</h2>
        {beoordeling ? (
          <>
            <p className="zekerheid-groot">
              <ZekerheidBadge zekerheid={beoordeling.zekerheid} /> <StatusBadge status={beoordeling.voorgestelde_status} />
            </p>
            <h3>Redenen</h3>
            <ul className="redenen-lijst">
              {beoordeling.redenen.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <BevestigAfwijsKnoppen beoordeling={beoordeling} onBijgewerkt={(b) => setDetail((d) => ({ ...d, huidige_beoordeling: b }))} />
          </>
        ) : (
          <p className="leeg-bericht">Nog geen beoordeling voor deze vestiging.</p>
        )}
        <button type="button" className="knop knop--secundair" disabled={herberekenBezig} onClick={herbereken}>
          {herberekenBezig ? 'Bezig met herberekenen…' : 'Beoordeling (opnieuw) berekenen'}
        </button>
      </section>

      <section className="paneel">
        <h2>Evidence-tijdlijn</h2>
        <EvidenceTijdlijn evidence={evidence} />
      </section>
    </div>
  )
}
