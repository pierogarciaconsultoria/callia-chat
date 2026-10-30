import { useState, type FormEvent, type ReactNode } from "react";
import { CALLIA_BRAND_STYLE } from "@/lib/branding";
import { Link, Navigate, useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { useSiteInfo } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/functions";
import { Button, Card, Input, Notice, PageLoader } from "@/components/ui";

export function translateAuthError(err: unknown): string {
  const msg = errorMessage(err);
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar.";
  if (/already registered|already been registered/i.test(msg)) return "Este e-mail já tem conta. Entre com a sua senha ou recupere o acesso.";
  if (/signups? not allowed|signup is disabled/i.test(msg))
    return "O cadastro aberto está desativado. Peça a um administrador para criar seu acesso.";
  if (/provider is not enabled/i.test(msg)) return "Login com Google não está habilitado neste servidor.";
  if (/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 8 caracteres.";
  return msg;
}

// Recursos que dependem da configuração do GoTrue do servidor.
const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

/** Moldura das telas públicas de acesso (login, cadastro, senha, boas-vindas). */
export function Shell({ children, title = "Callia Chat", subtitle = "Atendimento no WhatsApp com IA e equipe humana", wide = false }: { children: ReactNode; title?: string; subtitle?: string; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950" style={CALLIA_BRAND_STYLE}>
      <div className={wide ? "w-full max-w-xl" : "w-full max-w-sm"}>
        <div className="mb-6 flex flex-col items-center text-center">
          <Link to="/" className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-brand-fg" aria-label="Ir para o site">
            <MessageCircle className="h-6 w-6" />
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        {children}
        <p className="mt-6 flex flex-wrap justify-center gap-3 text-center text-xs text-slate-400">
          <Link to="/" className="hover:underline">← Voltar ao site</Link>
          <Link to="/termos" className="hover:underline">Termos de Uso</Link>
          <Link to="/privacidade" className="hover:underline">Privacidade</Link>
        </p>
      </div>
    </div>
  );
}

export default function Login() {
  const { user, loading, signInWithPassword, signInWithGoogle, requestPasswordReset } = useAuth();
  const ws = useWorkspace();
  const site = useSiteInfo();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading || (user && ws.loading)) return <PageLoader />;
  if (user && ws.workspaceId) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/" && from !== "/entrar" ? from : "/dashboard"} replace />;
  }
  // Logado sem workspace: o onboarding cria a empresa (cadastro) ou pede o nome.
  if (user) return <Navigate to="/bem-vindo" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        await signInWithPassword(email.trim(), password);
      } else {
        await requestPasswordReset(email.trim());
        setInfo("Se este e-mail tiver acesso, você vai receber um link para definir uma nova senha.");
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell subtitle={mode === "forgot" ? "Recuperar o acesso" : "Entre na sua conta"}>
      {!isSupabaseConfigured && (
        <div className="mb-4">
          <Notice tone="warn">
            Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> no arquivo <code>.env</code>.
          </Notice>
        </div>
      )}
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <Input label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode === "login" && (
            <Input label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Entrar" : "Enviar link"}
          </Button>
        </form>
        {mode === "login" && (
          <button type="button" className="mt-3 block w-full text-center text-sm text-slate-500 hover:underline" onClick={() => setMode("forgot")}>
            Esqueci minha senha
          </button>
        )}
        {googleEnabled && mode === "login" && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> ou <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                setError(null);
                try {
                  await signInWithGoogle();
                } catch (err) {
                  setError(translateAuthError(err));
                }
              }}
            >
              Entrar com Google
            </Button>
          </>
        )}
      </Card>
      <p className="mt-4 text-center text-sm text-slate-500">
        {mode === "forgot" ? (
          <button type="button" className="font-medium text-brand" onClick={() => setMode("login")}>
            Voltar para o login
          </button>
        ) : site.data?.self_service ? (
          <>
            Ainda não tem conta?{" "}
            <Link to="/cadastro" className="font-medium text-brand">
              Criar conta grátis
            </Link>
          </>
        ) : (
          "O acesso é criado por um administrador do workspace."
        )}
      </p>
    </Shell>
  );
}
