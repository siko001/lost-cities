import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isValidSupabaseUrl = typeof url === "string" && /^https?:\/\//.test(url);

export const isSupabaseConfigured = Boolean(isValidSupabaseUrl && anonKey);

export const supabase = isSupabaseConfigured && url && anonKey ? createClient(url, anonKey) : null;
