// De gemeente bevestigt dat een zaak actief is (na telefoontje of bezoek), of trekt die bevestiging in.
// Wordt bewaard als evidence (bron: gemeente) en telt 12 maanden; daarna wordt de score herberekend.
import { adminClient, handler, json, parseSubject } from '../_shared/http.ts';
import { loadSubject, runAnalysis } from '../_shared/analysis.ts';

const METHODS = ['telefonisch contact', 'bezoek ter plaatse', 'e-mail of brief', 'andere'];

Deno.serve(handler(async (req) => {
  const body = await req.json();
  const s = parseSubject(body);
  const action = body.action === 'revoke' ? 'revoke' : 'confirm_active';
  const method = METHODS.includes(body.method) ? body.method : null;
  const db = adminClient();
  const { enterprise } = await loadSubject(db, s);

  const today = new Date().toLocaleDateString('nl-BE');
  const { error } = await db.from('evidence').insert({
    enterprise_number: enterprise.enterprise_number,
    establishment_number: s.subject_type === 'establishment' ? s.number : null,
    source: 'officer',
    evidence_type: 'business_status',
    value: { action, method },
    summary_nl: action === 'confirm_active'
      ? `Gemeente bevestigt op ${today} dat deze zaak actief is${method ? ` (${method})` : ''}`
      : `Gemeente trekt op ${today} de bevestiging in`,
  });
  if (error) throw error;
  return json({ analysis: await runAnalysis(db, s) });
}));
