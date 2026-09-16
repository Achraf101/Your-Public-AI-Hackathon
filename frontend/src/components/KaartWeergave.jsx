import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import { ZEKERHEID_MARKERKLEUR } from '../labels'

// Gratis kaarttegels van OpenStreetMap — geen betaalde API-key nodig.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTIE = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-medewerkers'

/** Middelste waarde van een lijst getallen — ongevoelig voor uitschieters, in tegenstelling tot het gemiddelde. */
function mediaan (getallen) {
  const gesorteerd = [...getallen].sort((a, b) => a - b)
  const midden = Math.floor(gesorteerd.length / 2)
  return gesorteerd.length % 2 ? gesorteerd[midden] : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2
}

// De VKBO/Adressenregister-geocoding bevat af en toe een foutieve coördinaat
// (in de praktijk gezien: 2 van de 379 Paalstraat-vestigingen kregen een
// locatie in Creil, Frankrijk toegewezen in plaats van Schoten). Zo'n
// uitschieter wordt WEL als marker getoond — niets verbergen — maar telt niet
// mee bij het automatisch inzoomen, anders toont de kaart heel West-Europa
// in plaats van de eigenlijke straat.
const MAX_AFSTAND_VOOR_INZOOMEN = 0.5 // graden, ruim boven gemeentegrootte

function PasBereikAan ({ punten }) {
  const map = useMap()
  useEffect(() => {
    if (punten.length === 0) return
    const medianLat = mediaan(punten.map((p) => p.lat))
    const medianLng = mediaan(punten.map((p) => p.lng))
    const kernpunten = punten.filter(
      (p) => Math.abs(p.lat - medianLat) < MAX_AFSTAND_VOOR_INZOOMEN && Math.abs(p.lng - medianLng) < MAX_AFSTAND_VOOR_INZOOMEN
    )
    const teGebruiken = kernpunten.length > 0 ? kernpunten : punten

    if (teGebruiken.length === 1) {
      map.setView([teGebruiken[0].lat, teGebruiken[0].lng], 17)
      return
    }
    map.fitBounds(teGebruiken.map((p) => [p.lat, p.lng]), { padding: [24, 24] })
  }, [punten, map])
  return null
}

/**
 * @param {Array<{ id: string, lat: number, lng: number, naam: string, zekerheid?: string|null }>} punten
 * @param {(id: string) => void} [onMarkerKlik]
 */
export default function KaartWeergave ({ punten, onMarkerKlik, hoogte = 360 }) {
  const geldigePunten = punten.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')

  if (geldigePunten.length === 0) {
    return (
      <div className="kaart-leeg" style={{ height: hoogte }}>
        Geen coördinaten beschikbaar om op de kaart te tonen.
      </div>
    )
  }

  return (
    <MapContainer
      center={[geldigePunten[0].lat, geldigePunten[0].lng]}
      zoom={16}
      style={{ height: hoogte, width: '100%', borderRadius: 16 }}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTIE} />
      <PasBereikAan punten={geldigePunten} />
      {geldigePunten.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={9}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: ZEKERHEID_MARKERKLEUR[p.zekerheid] ?? '#8a8f98',
            fillOpacity: 0.85
          }}
          eventHandlers={onMarkerKlik ? { click: () => onMarkerKlik(p.id) } : undefined}
        >
          <Popup>
            <strong>{p.naam ?? p.id}</strong>
            <br />
            Zekerheid: {p.zekerheid ?? 'nog niet beoordeeld'}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
