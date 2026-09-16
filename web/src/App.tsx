import { useEffect, useState } from 'react';
import SearchPage, { type SearchState } from './components/SearchPage';
import RecordDetail from './components/RecordDetail';
import UsageBar from './components/UsageBar';
import type { SubjectType } from './lib/types';

type View = { name: 'search' } | { name: 'record'; subjectType: SubjectType; number: string };

const REVIEWER_KEY = 'bedrijvenradar.reviewer';

function readReviewer(): string {
  try { return localStorage.getItem(REVIEWER_KEY) ?? ''; } catch { return ''; }
}

export default function App() {
  const [view, setView] = useState<View>({ name: 'search' });
  const [reviewer, setReviewer] = useState(readReviewer);
  // Zoekstatus blijft bewaard als je terugkeert van een detail.
  const [search, setSearch] = useState<SearchState>({ query: '', mode: 'auto', municipalityId: '', response: null });

  useEffect(() => {
    try { localStorage.setItem(REVIEWER_KEY, reviewer); } catch { /* opslag niet beschikbaar */ }
  }, [reviewer]);

  return (
    <div className="min-h-screen text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <button onClick={() => setView({ name: 'search' })} className="text-left">
            <div className="text-lg font-semibold tracking-tight">Bedrijvenradar</div>
            <div className="text-xs text-slate-500">Is deze zaak nog actief — en waarop baseren we dat?</div>
          </button>
          <div className="flex flex-wrap items-center gap-4">
            <UsageBar />
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">Medewerker</span>
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Uw naam"
                className="w-40 rounded-md border border-slate-300 px-2 py-1 focus:border-sky-500 focus:outline-none"
              />
            </label>
          </div>
        </div>
        {view.name === 'record' && (
          <nav className="mx-auto max-w-7xl px-4 pb-2 text-sm text-slate-500">
            <button className="hover:underline" onClick={() => setView({ name: 'search' })}>← Terug naar zoekresultaten</button>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {view.name === 'search' && (
          <SearchPage state={search} onChange={setSearch} onOpen={(subjectType, number) => setView({ name: 'record', subjectType, number })} />
        )}
        {view.name === 'record' && (
          <RecordDetail
            key={`${view.subjectType}-${view.number}`}
            subjectType={view.subjectType}
            number={view.number}
            reviewer={reviewer}
            onOpen={(subjectType, number) => setView({ name: 'record', subjectType, number })}
          />
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400">
        Bronnen: publieke KBO gegevens, verrijkt met adressen uit het Vlaamse Adressenregister (VKBO, Modellicentie Gratis Hergebruik) · KBO API (cbeapi.be) · Google Places · Jaarrekening.be · websites.
        De activiteitsscore is een hulpmiddel, geen gekalibreerde kans; de medewerker beslist.
      </footer>
    </div>
  );
}
