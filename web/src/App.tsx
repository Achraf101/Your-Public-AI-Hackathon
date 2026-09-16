import { useState } from 'react';
import SearchPage, { type SearchState } from './components/SearchPage';
import RecordDetail from './components/RecordDetail';
import type { SubjectType } from './lib/types';

type View = { name: 'search' } | { name: 'record'; subjectType: SubjectType; number: string };

export default function App() {
  const [view, setView] = useState<View>({ name: 'search' });
  // Zoekopdracht blijft bewaard als je terugkeert van een zaak.
  const [search, setSearch] = useState<SearchState>({ query: '', municipalityId: '', response: null });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <button onClick={() => setView({ name: 'search' })} className="text-left">
            <div className="text-lg font-semibold tracking-tight">Bedrijvenradar</div>
            <div className="text-xs text-slate-500">Welke zaken zijn nog actief in de gemeente?</div>
          </button>
          {view.name === 'record' && (
            <button onClick={() => setView({ name: 'search' })} className="rounded-md px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              ← Terug naar de lijst
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {view.name === 'search' && (
          <SearchPage state={search} onChange={setSearch} onOpen={(subjectType, number) => setView({ name: 'record', subjectType, number })} />
        )}
        {view.name === 'record' && (
          <RecordDetail key={`${view.subjectType}-${view.number}`} subjectType={view.subjectType} number={view.number} />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-400">
        Bronnen: KBO (via Digitaal Vlaanderen en cbeapi.be), Google, websites en jaarrekeningen. De score is een hulpmiddel: bij twijfel even bellen of langsgaan.
      </footer>
    </div>
  );
}
