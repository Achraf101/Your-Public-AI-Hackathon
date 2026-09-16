// Frontend gebruikt enkel de publieke anon key. Geheime API-keys zitten uitsluitend in Edge Functions.
import { createClient } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY ontbreken in web/.env.local');

export const supabase = createClient(url, anonKey);

/** Roept een Edge Function aan en geeft een leesbare foutmelding terug. */
export async function invokeFunction<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? payload?.message ?? error.message);
    }
    throw error;
  }
  return data as T;
}
