import { createContext, useContext, useEffect, useState } from 'react'

// Er is geen authenticatie in dit prototype (zie README van de backend): de
// naam van de ambtenaar wordt hier lokaal onthouden (localStorage) en
// meegegeven aan elke bevestig/wijs-af-aanroep als beoordeeld_door. In een
// echte inzet zou dit uit een ingelogde sessie komen, nooit door de
// gebruiker zelf te typen.
//
// Eén Context-Provider (in App.jsx) houdt de naam bij: het veld in de header
// en de knoppen op de detail-/review-pagina's moeten dezelfde waarde zien
// zodra de gebruiker typt, niet elk hun eigen kopie die enkel bij het
// opstarten uit localStorage leest.
const SLEUTEL = 'ftrb.beoordelaar'
const BeoordelaarContext = createContext(null)

export function BeoordelaarProvider ({ children }) {
  const [naam, setNaam] = useState(() => localStorage.getItem(SLEUTEL) ?? '')

  useEffect(() => {
    if (naam) localStorage.setItem(SLEUTEL, naam)
    else localStorage.removeItem(SLEUTEL)
  }, [naam])

  return <BeoordelaarContext.Provider value={[naam, setNaam]}>{children}</BeoordelaarContext.Provider>
}

export function useBeoordelaar () {
  const context = useContext(BeoordelaarContext)
  if (!context) throw new Error('useBeoordelaar() moet binnen <BeoordelaarProvider> gebruikt worden')
  return context
}
