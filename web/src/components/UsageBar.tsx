import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Usage = { source: string; today: number; this_month: number };

// Toont verbruik van betaalde/gelimiteerde API's t.o.v. de gratis limiet (zichtbaar = geen verrassingen).
const LIMITS: Record<string, { label: string; month: number }> = {
  google_places: { label: 'Google', month: 900 },
  kbo_api: { label: 'KBO API', month: 5000 },
  jaarrekening: { label: 'Jaarrekening', month: 190 },
};

export default function UsageBar() {
  const [usage, setUsage] = useState<Usage[]>([]);

  useEffect(() => {
    const load = () => supabase.from('api_usage_month').select('*').then(({ data }) => setUsage((data ?? []) as Usage[]));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex gap-3 text-xs text-slate-500" title="Verbruik deze maand t.o.v. de ingestelde gratis limiet">
      {Object.entries(LIMITS).map(([source, l]) => {
        const u = usage.find((x) => x.source === source);
        return (
          <span key={source}>
            {l.label} <strong className="text-slate-700">{u?.this_month ?? 0}</strong>/{l.month}
          </span>
        );
      })}
    </div>
  );
}
