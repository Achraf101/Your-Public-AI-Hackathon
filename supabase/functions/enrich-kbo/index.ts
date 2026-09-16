// KBO API (CBEAPI) voor één ondernemingsnummer.
import { adminClient, handler, json } from '../_shared/http.ts';
import { runKbo } from '../_shared/sources.ts';

Deno.serve(handler(async (req) => {
  const { enterprise_number } = await req.json();
  if (!/^\d{10}$/.test(String(enterprise_number ?? ''))) return json({ error: 'enterprise_number moet 10 cijfers zijn (als tekst)' }, 400);
  return json(await runKbo(adminClient(), enterprise_number));
}));
