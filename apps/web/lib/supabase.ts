import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — see apps/web/.env.example"
  );
}

// Read-only from the dashboard's perspective: the anon key is bound by
// the warehouse's row-level-security policies to SELECT only. Writes
// happen server-side via services/ingestion's sync module, using the
// service role key, which never reaches this app.
export const supabase = createClient(url, anonKey);
