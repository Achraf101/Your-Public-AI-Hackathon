import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/** Haalt GET /straten/:gemeente/:straat op en biedt een herlaad-functie voor na een beoordeling. */
export function useStraatData (gemeente, straat) {
  const [data, setData] = useState(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState(null)

  const herlaad = useCallback(() => {
    if (!gemeente || !straat) return
    setLaden(true)
    setFout(null)
    api.haalStraatOverzicht(gemeente, straat)
      .then(setData)
      .catch(setFout)
      .finally(() => setLaden(false))
  }, [gemeente, straat])

  useEffect(() => { herlaad() }, [herlaad])

  return { data, laden, fout, herlaad }
}

/** Alle losse vestigingen, met domicilie-groepsleden uitgeklapt — handig voor KPI's/kaart/zoeken over de volledige straat. */
export function alleVestigingenPlat (straatData) {
  if (!straatData) return []
  const rijen = []
  for (const b of straatData.bedrijven) {
    if (b.type === 'vestiging') rijen.push(b)
    else if (b.type === 'domicilie_groep') rijen.push(...b.leden)
  }
  return rijen
}
