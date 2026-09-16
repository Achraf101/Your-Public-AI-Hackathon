// CORS + JSON-antwoorden + admin-client (service role, enkel server-side).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export type Subject = { subject_type: 'enterprise' | 'establishment'; number: string };

export function parseSubject(body: any): Subject {
  const subject_type = body?.subject_type;
  const number = String(body?.number ?? '').trim();
  if (!['enterprise', 'establishment'].includes(subject_type)) throw new Error('subject_type moet enterprise of establishment zijn');
  if (!/^\d{10}$/.test(number)) throw new Error('number moet 10 cijfers zijn (als tekst)');
  return { subject_type, number };
}

/** Harde dag- en maandlimiet per externe bron (tabel api_usage). amount = aantal requests dat verstuurd zal worden. */
export async function consumeQuota(db: SupabaseClient, source: string, opts: { amount?: number; dailyEnv: string; dailyDefault: number; monthlyEnv: string; monthlyDefault: number }): Promise<boolean> {
  const { data, error } = await db.rpc('consume_api_quota_v2', {
    p_source: source,
    p_amount: opts.amount ?? 1,
    p_daily_limit: Number(Deno.env.get(opts.dailyEnv) ?? opts.dailyDefault),
    p_monthly_limit: Number(Deno.env.get(opts.monthlyEnv) ?? opts.monthlyDefault),
  });
  if (error) throw error;
  return data === true;
}

/** Is er evidence van deze bron voor dit onderwerp, recenter dan maxAgeDays? */
export async function hasRecentEvidence(db: SupabaseClient, source: string, col: 'enterprise_number' | 'establishment_number', number: string, maxAgeDays: number, extra?: (q: any) => any): Promise<boolean> {
  const since = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  let q = db.from('evidence').select('id').eq('source', source).eq(col, number).gte('retrieved_at', since).neq('evidence_type', 'error').limit(1);
  if (extra) q = extra(q);
  const { data } = await q;
  return !!data?.length;
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  };
}
