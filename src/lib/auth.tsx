import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { LEGAL_VERSION } from "./legal";

/** Dados do cadastro guardados no usuário; viram o workspace em /bem-vindo (create_workspace_from_signup). */
export interface SignupMetadata {
  company_name: string;
  segment?: string;
  website?: string;
  whatsapp?: string;
  /** Nome de quem está criando a conta (vira o nome de exibição na equipe). */
  full_name?: string;
  /** Aceite dos Termos de Uso e da Política de Privacidade (versão em src/lib/legal.ts). */
  terms_accepted_at?: string;
  terms_version?: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, metadata?: SignupMetadata) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  /** Registra o aceite dos Termos e da Política nos metadados do usuário (convidados, no definir senha). */
  acceptTerms: () => Promise<void>;
  /** Nome de exibição do próprio usuário (mostrado à equipe e nas mensagens de sistema). */
  updateProfile: (fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => active && setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password, metadata) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/bem-vindo`, ...(metadata ? { data: metadata } : {}) },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async signInWithGoogle() {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/entrar` },
        });
        if (error) throw error;
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/definir-senha`,
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      },
      async acceptTerms() {
        const { error } = await supabase.auth.updateUser({ data: { terms_accepted_at: new Date().toISOString(), terms_version: LEGAL_VERSION } });
        if (error) throw error;
      },
      async updateProfile(fullName) {
        const { error } = await supabase.auth.updateUser({ data: { full_name: fullName.trim().slice(0, 80) } });
        if (error) throw error;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
