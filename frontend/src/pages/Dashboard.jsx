import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import StraatKiezer from '../components/StraatKiezer'
import KpiKaart from '../components/KpiKaart'
import KaartWeergave from '../components/KaartWeergave'
import ZekerheidBadge from '../components/ZekerheidBadge'
import StatusBadge from '../components/StatusBadge'
import { useStraatData, alleVestigingenPlat } from '../useStraatData'
import {
  STATUS_LABEL, formatteerAdres, bandVanBeoordeling, zekerheidSorteersleutel,
  ZEKERHEID_DREMPEL_HOOG, ZEKERHEID_DREMPEL_MIDDEL
} from '../labels'
import { api } from '../api'

// Filteren gebeurt nu op kansbereik i.p.v. op het woord alleen — het label
// toont allebei, zodat duidelijk blijft waar de grenzen liggen.
const ZEKERHEID_OPTIES = [
  { band: 'Hoog', label: `Hoog (≥ ${ZEKERHEID_DREMPEL_HOOG}%)` },
  { band: 'Middel', label: `Middel (${ZEKERHEID_DREMPEL_MIDDEL}–${ZEKERHEID_DREMPEL_HOOG - 1}%)` },
  { band: 'Laag', label: `Laag (< ${ZEKERHEID_DREMPEL_MIDDEL}%)` }
]
// Bewust exact de 5 statuswaarden uit de opdracht als filterknop — de engine
// kan ook 'waarschijnlijk_actief' voorstellen; die blijft gewoon zichtbaar in
// de lijst, maar krijgt geen eigen knop (zo expliciet gevraagd).
const STATUS_OPTIES = ['actief', 'waarschijnlijk_inactief', 'kbo_niet_op_adres']

function wisselInSet (set, waarde) {
  const nieuw = new Set(set)
  nieuw.has(waarde) ? nieuw.delete(waarde) : nieuw.add(waarde)
  return nieuw
}

export default function Dashboard () {
  const [params, setParams] = useSearchParams()
  const gemeente = params.get('gemeente') ?? 'Schoten'
  const straat = params.get('straat') ?? 'Paalstraat'
  const navigate = useNavigate()

  const { data, laden, fout, herlaad } = useStraatData(gemeente, straat)
  const [zoekterm, setZoekterm] = useState('')
  const [zekerheidFilter, setZekerheidFilter] = useState(new Set())
  const [statusFilter, setStatusFilter] = useState(new Set())
  const [sorteerOplopend, setSorteerOplopend] = useState(true) // true = Laag -> Hoog (default)
  const [herberekenen, setHerberekenen] = useState(false)
  const [actieMelding, setActieMelding] = useState(null)

  const vestigingen = useMemo(() => alleVestigingenPlat(data), [data])

  const kpis = useMemo(() => {
    const totaal = data?.aantal_establishments ?? 0
    let actief = 0, inactief = 0, ontbrekend = 0, laag = 0, teControleren = 0
    const percentages = []
    for (const v of vestigingen) {
      const status = v.beoordeling?.voorgestelde_status
      if (status === 'actief' || status === 'waarschijnlijk_actief') actief++
      if (status === 'waarschijnlijk_inactief') inactief++
      if (status === 'mogelijk_ontbrekend') ontbrekend++
      if (bandVanBeoordeling(v.beoordeling) === 'Laag') laag++
      if (!v.beoordeling || v.beoordeling.status === 'te_controleren') teControleren++
      if (typeof v.beoordeling?.zekerheid_percentage === 'number') {
        percentages.push(v.beoordeling.zekerheid_percentage)
      }
    }
    const gemiddelde = percentages.length > 0
      ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
      : null
    return { totaal, actief, inactief, ontbrekend, laag, teControleren, gemiddelde }
  }, [data, vestigingen])

  const gefilterd = useMemo(() => {
    const term = zoekterm.trim().toLowerCase()
    let lijst = vestigingen.filter((v) => {
      if (zekerheidFilter.size > 0 && !zekerheidFilter.has(bandVanBeoordeling(v.beoordeling))) return false
      if (statusFilter.size > 0 && !statusFilter.has(v.beoordeling?.voorgestelde_status)) return false
      if (!term) return true
      const doorzoekbaar = [
        v.naam, v.vestiging_id, v.adres?.straat, v.adres?.postcode, v.adres?.gemeente,
        v.nace_afdeling_rsz, v.nace_afdeling_btw,
        v.beoordeling?.voorgestelde_status ? STATUS_LABEL[v.beoordeling.voorgestelde_status] : null
      ].filter(Boolean).join(' ').toLowerCase()
      return doorzoekbaar.includes(term)
    })
    // Sorteren op het percentage zelf, niet op de band: binnen "Laag" is 8%
    // dringender dan 31%, en dat verschil zag je vroeger niet.
    lijst = [...lijst].sort((a, b) => {
      const ra = zekerheidSorteersleutel(a.beoordeling)
      const rb = zekerheidSorteersleutel(b.beoordeling)
      return sorteerOplopend ? ra - rb : rb - ra
    })
    return lijst
  }, [vestigingen, zoekterm, zekerheidFilter, statusFilter, sorteerOplopend])

  const kaartPunten = gefilterd.map((v) => ({
    id: v.vestiging_id,
    lat: v.latitude,
    lng: v.longitude,
    naam: v.naam,
    zekerheid: bandVanBeoordeling(v.beoordeling),
    percentage: v.beoordeling?.zekerheid_percentage ?? null
  }))

  async function herberekenStraat () {
    setHerberekenen(true)
    setActieMelding(null)
    try {
      const resultaat = await api.herberekenStraat(gemeente, straat)
      const gemiddelde = resultaat.gemiddeld_percentage != null
        ? ` Gemiddelde kans: ${resultaat.gemiddeld_percentage}%.`
        : ''
      setActieMelding(`${resultaat.aantal - resultaat.uitgesloten} voorstellen bijgewerkt: ${resultaat.Hoog} hoog (≥70%), ${resultaat.Middel} middel (40–69%), ${resultaat.Laag} laag (<40%).${gemiddelde}`)
      herlaad()
    } catch (e) {
      setActieMelding(`Herberekenen mislukte: ${e.message}`)
    } finally {
      setHerberekenen(false)
    }
  }

  return (
    <div className="pagina">
      <div className="pagina-kop">
        <div>
          <p className="eyebrow">Controlecentrum</p>
          <h1>Welke zaken verdienen aandacht?</h1>
          <p className="pagina-intro">
            Elke zaak krijgt een kans dat ze echt actief is op het geregistreerde adres,
            berekend uit de signalen die je bij de zaak zelf terugvindt. Laagste kans eerst.
          </p>
          <span className="demo-label">Demo-modus · mocksignalen</span>
        </div>
        <button type="button" className="knop knop--primair" disabled={herberekenen} onClick={herberekenStraat}>
          {herberekenen ? 'Beoordelingen bijwerken…' : 'Herbereken straat'}
        </button>
      </div>
      <p className="pagina-intro">
        Overzicht van de geselecteerde straat/gemeente — voor een volledige, tabelmatige
        analyse per adres, zie <em>Analyseer straat</em>.
      </p>

      <StraatKiezer gemeente={gemeente} straat={straat} onWijzig={({ gemeente, straat }) => setParams({ gemeente, straat })} />

      {laden && <p>Bezig met laden…</p>}
      {fout && <p className="foutmelding">Kon de gegevens niet ophalen: {fout.message}</p>}
      {actieMelding && <p className={actieMelding.startsWith('Herberekenen mislukte') ? 'foutmelding' : 'succesmelding'}>{actieMelding}</p>}

      {data && (
        <>
          <div className="kpi-rij">
            <KpiKaart label="Vestigingen" waarde={kpis.totaal} />
            <KpiKaart label="Waarschijnlijk actief" waarde={kpis.actief} accent="#15803d" />
            <KpiKaart label="Mogelijk inactief" waarde={kpis.inactief} accent="#dc2626" />
            <KpiKaart label="Kans < 40%" waarde={kpis.laag} toelichting="Eerst nakijken" accent="#dc2626" />
            <KpiKaart
              label="Gemiddelde kans"
              waarde={kpis.gemiddelde != null ? `${kpis.gemiddelde}%` : '—'}
              toelichting="Over deze straat"
            />
            <KpiKaart label="Open voorstellen" waarde={kpis.teControleren} accent="#d97706" />
          </div>

          <div className="uitleg-balk">
            <strong>Demo met mockdata:</strong> Groen = bevestigd actief, oranje = adresconflict, rood = vermoedelijk gesloten. Elke filter heeft resultaten; de originele VKBO-adressen blijven apart herkenbaar als registerdata.
          </div>

          <div className="werkbalk">
            <input
              type="search"
              className="zoekveld"
              placeholder="Zoek een bedrijf of adres…"
              value={zoekterm}
              onChange={(e) => setZoekterm(e.target.value)}
            />
            <button type="button" className="knop knop--secundair" onClick={() => setSorteerOplopend((v) => !v)}>
              Sorteer op kans: {sorteerOplopend ? 'laagste eerst' : 'hoogste eerst'}
            </button>
          </div>

          <div className="filter-rij">
            <div className="filter-groep">
              <span className="filter-groep__label">Kans:</span>
              {ZEKERHEID_OPTIES.map((z) => (
                <button
                  key={z.band}
                  type="button"
                  className={`filter-knop ${zekerheidFilter.has(z.band) ? 'filter-knop--actief' : ''}`}
                  onClick={() => setZekerheidFilter((s) => wisselInSet(s, z.band))}
                >
                  {z.label}
                </button>
              ))}
            </div>
            <div className="filter-groep">
              <span className="filter-groep__label">Status:</span>
              {STATUS_OPTIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-knop ${statusFilter.has(s) ? 'filter-knop--actief' : ''}`}
                  onClick={() => setStatusFilter((set) => wisselInSet(set, s))}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="kaart-lijst-layout">
            <KaartWeergave punten={kaartPunten} onMarkerKlik={(id) => navigate(`/vestiging/${id}`)} />
            <ul className="vestiging-lijst">
              {gefilterd.length === 0 && <li className="leeg-bericht">Geen vestigingen gevonden voor deze zoekopdracht/filters.</li>}
              {gefilterd.map((v) => (
                <li key={v.vestiging_id} className="vestiging-lijst__item" onClick={() => navigate(`/vestiging/${v.vestiging_id}`)}>
                  <div>
                    <div className="vestiging-lijst__naam">{v.naam ?? v.vestiging_id}</div>
                    <div className="vestiging-lijst__adres">{formatteerAdres(v.adres)}</div>
                  </div>
                  <div className="vestiging-lijst__badges">
                    <ZekerheidBadge
                      percentage={v.beoordeling?.zekerheid_percentage}
                      zekerheid={v.beoordeling?.zekerheid}
                    />
                    <StatusBadge status={v.beoordeling?.voorgestelde_status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
