// Jaarrekening.be voor één ondernemingsnummer (actief als JAARREKENING_ENABLED=true).
import { adminClient, handler, json } from '../_shared/http.ts';
import { runAccounts } from '../_shared/sources.ts';

Deno.serve(handler(async (req) => {
  const { enterprise_number } = await req.json();
  if (!/^\d{10}$/.test(String(enterprise_number ?? ''))) return json({ error: 'enterprise_number moet 10 cijfers zijn (als tekst)' }, 400);
  const db = adminClient();
  const { data } = await db.from('enterprises').select('entity_type').eq('enterprise_number', enterprise_number).maybeSingle();
  return json(await runAccounts(db, enterprise_number, data?.entity_type ?? null));
}));
