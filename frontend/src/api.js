// ============================================================================
// Dunne client voor de backend-API (server/app.js). Elke functie spiegelt
// exact één endpoint — geen logica hier, enkel de HTTP-aanroep en foutafhandeling.
// ============================================================================

const BASIS_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function verzoek (pad, opties) {
  const resp = await fetch(BASIS_URL + pad, {
    ...opties,
    headers: { 'Content-Type': 'application/json', ...(opties?.headers ?? {}) }
  })
  const isJson = resp.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await resp.json() : null
  if (!resp.ok) {
    const fout = new Error(body?.fout ?? `${resp.status} ${resp.statusText}`)
    fout.status = resp.status
    fout.body = body
    throw fout
  }
  return body
}

export const api = {
  haalStraten: (gemeente) => verzoek(`/straten/${encodeURIComponent(gemeente)}`),

  haalStraatOverzicht: (gemeente, straat) =>
    verzoek(`/straten/${encodeURIComponent(gemeente)}/${encodeURIComponent(straat)}`),

  haalVestigingDetail: (id) => verzoek(`/vestiging/${encodeURIComponent(id)}`),

  herbereken: (id) => verzoek(`/vestiging/${encodeURIComponent(id)}/beoordeel`, { method: 'POST' }),

  herberekenStraat: (gemeente, straat) =>
    verzoek(`/straten/${encodeURIComponent(gemeente)}/${encodeURIComponent(straat)}/beoordeel`, { method: 'POST' }),

  bevestig: (beoordelingId, beoordeeldDoor) =>
    verzoek(`/beoordeling/${encodeURIComponent(beoordelingId)}/bevestig`, {
      method: 'POST',
      body: JSON.stringify({ beoordeeld_door: beoordeeldDoor })
    }),

  wijsAf: (beoordelingId, beoordeeldDoor) =>
    verzoek(`/beoordeling/${encodeURIComponent(beoordelingId)}/wijs-af`, {
      method: 'POST',
      body: JSON.stringify({ beoordeeld_door: beoordeeldDoor })
    }),

  haalTeControleren: () => verzoek('/te-controleren')
}
