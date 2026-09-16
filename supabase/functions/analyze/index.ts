// Voert enkel het regelmodel opnieuw uit (geen externe requests).
import { adminClient, handler, json, parseSubject } from '../_shared/http.ts';
import { runAnalysis } from '../_shared/analysis.ts';

Deno.serve(handler(async (req) => json(await runAnalysis(adminClient(), parseSubject(await req.json())))));
