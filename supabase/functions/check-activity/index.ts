// Controleert de activiteit van één vestiging of onderneming: haalt alle bronnen op en berekent de activiteitsscore.
// Google Places enkel als include_google = true (knop) of GOOGLE_AUTO_ON_OPEN=true; altijd met cache en gratis limiet.
import { adminClient, handler, json, parseSubject } from '../_shared/http.ts';
import { loadSubject, runAnalysis } from '../_shared/analysis.ts';
import { runAccounts, runGoogle, runKbo, runWebsite, type StepResult } from '../_shared/sources.ts';

Deno.serve(handler(async (req) => {
  const body = await req.json();
  const s = parseSubject(body);
  const db = adminClient();
  const steps: StepResult[] = [];

  const { enterprise } = await loadSubject(db, s);
  const entNr = enterprise.enterprise_number;

  // 1. Officieel register (KBO API): status, type, vestigingen, contact.
  steps.push(await runKbo(db, entNr, { maxAgeDays: 7 }));
  const { data: entAfter } = await db.from('enterprises').select('entity_type').eq('enterprise_number', entNr).single();

  // 2. Jaarrekening + Staatsblad (ondernemingsniveau) en 3. Google (optioneel) parallel.
  const includeGoogle = body.include_google === true || Deno.env.get('GOOGLE_AUTO_ON_OPEN') === 'true';
  const skippedGoogle: StepResult = { source: 'google_places', status: 'skipped', message: 'Google Places niet opgevraagd (gebruik de knop)' };
  const [accounts, google] = await Promise.all([
    runAccounts(db, entNr, entAfter?.entity_type ?? null),
    includeGoogle ? runGoogle(db, s) : Promise.resolve(skippedGoogle),
  ]);
  steps.push(accounts, google);

  // 4. Website (na Google, zodat een gevonden website mee gecontroleerd wordt).
  steps.push(await runWebsite(db, s, entNr));

  // 5. Analyse.
  const analysis = await runAnalysis(db, s);
  return json({ steps, analysis });
}));
