import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

// Sem env configurado o app ainda renderiza (mostra aviso na tela de login).
export const supabase = createClient(SUPABASE_URL || "http://localhost:54321", SUPABASE_KEY || "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const PUBLIC_API_BASE = `${SUPABASE_URL}/functions/v1/public-api`;
