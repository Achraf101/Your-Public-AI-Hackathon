import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Straatoverzicht from './pages/Straatoverzicht'
import VestigingDetail from './pages/VestigingDetail'
import TeControleren from './pages/TeControleren'
import { useBeoordelaar, BeoordelaarProvider } from './useBeoordelaar.jsx'

function Header () {
  const [naam, setNaam] = useBeoordelaar()
  return (
    <header className="app-header">
      <div className="app-header__titel">
        <strong>Find the Real Businesses</strong>
        <span className="app-header__ondertitel">Economie-dashboard — Provincie Antwerpen</span>
      </div>
      <nav className="app-nav">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/straat">Analyseer straat</NavLink>
        <NavLink to="/te-controleren">Te controleren</NavLink>
      </nav>
      <label className="app-header__gebruiker">
        <span>Ingelogd als</span>
        <input
          type="text"
          placeholder="je naam"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
        />
      </label>
    </header>
  )
}

export default function App () {
  return (
    <BeoordelaarProvider>
      <BrowserRouter>
        <Header />
        <main className="app-inhoud">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/straat" element={<Straatoverzicht />} />
            <Route path="/vestiging/:id" element={<VestigingDetail />} />
            <Route path="/te-controleren" element={<TeControleren />} />
          </Routes>
        </main>
        <footer className="app-footer">
          Prototype — dit dashboard past enkel voorstellen aan in deze tool, nooit het officiële KBO-register.
        </footer>
      </BrowserRouter>
    </BeoordelaarProvider>
  )
}
