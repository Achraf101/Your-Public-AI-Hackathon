// Google Places voor één onderwerp (met cache en gratis dag-/maandlimiet).
import { adminClient, handler, json, parseSubject } from '../_shared/http.ts';
import { runGoogle } from '../_shared/sources.ts';

Deno.serve(handler(async (req) => {
  const body = await req.json();
  return json(await runGoogle(adminClient(), parseSubject(body), { force: body.force === true }));
}));
