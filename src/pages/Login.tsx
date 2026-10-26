import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { usePlatformSettings } from "@/hooks/use-entitlements";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/functions";
import { Button, Card, Input, Notice, PageLoader } from "@/components/ui";

function translateAuthError(err: unknown): string {
  const msg = errorMessage(err);
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar.";
  if (/signups? not allowed|signup is disabled/i.test(msg))
    return "O cadastro aberto está desativado. Peça a um administrador para criar seu acesso.";
  if (/provider is not enabled/i.test(msg)) return "Login com Google não está habilitado neste servidor.";
  return msg;
}

// Recursos que dependem da configuração do GoTrue do servidor.
const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
const signupEnabled = import.meta.env.VITE_SIGNUP_ENABLED === "true";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-brand-fg">
            <MessageCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Callia Chat</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Atendimento no WhatsApp com IA e equipe humana</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Onboarding() {
  const { refresh, isPlatformAdmin, platformAdminLoading } = useWorkspace();
  const { signOut, user } = useAuth();
  const settings = usePlatformSettings();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (platformAdminLoading || settings.isLoading) return <PageLoader />;
  const canCreate = isPlatformAdmin || settings.data?.allow_self_service_workspaces === true;
  const supportEmail = settings.data?.support_email;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_workspace", { p_name: name.trim() });
    if (rpcError) {
      setError(errorMessage(new Error(rpcError.message)));
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
  }

  const footer = (
    <p className="mt-4 text-center text-xs text-slate-500">
      Conectado como {user?.email}.{" "}
      <button type="button" className="underline" onClick={() => void signOut()}>
        Sair
      </button>
    </p>
  );

  if (!canCreate) {
    return (
      <Shell>
        <Card className="p-5">
          <h2 className="text-base font-semibold">Aguardando liberação</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Seu acesso ainda não está vinculado a um workspace. Peça ao administrador da plataforma.
          </p>
          {supportEmail && (
            <p className="mt-3 text-sm">
              Suporte:{" "}
              <a className="font-medium text-brand" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>
            </p>
          )}
          <Button variant="secondary" className="mt-4 w-full" onClick={() => void refresh()}>
            Verificar de novo
          </Button>
        </Card>
        {footer}
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Crie seu workspace</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          O workspace guarda as conversas, a configuração do agente e as integrações da sua empresa, isolados de outros clientes.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Input
            label="Nome da empresa"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={120}
            required
            placeholder="Ex.: Pousada Mar Azul"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={busy} disabled={name.trim().length < 2}>
            Criar workspace
          </Button>
        </form>
        {isPlatformAdmin && (
          <Link
            to="/admin"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ShieldCheck className="h-4 w-4" /> Ir para o console da plataforma
          </Link>
        )}
      </Card>
      {footer}
    </Shell>
  );
}

export default function Login() {
  const { user, loading, signInWithPassword, signInWithGoogle, signUp, requestPasswordReset } = useAuth();
  const ws = useWorkspace();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading || (user && ws.loading)) return <PageLoader />;
  if (user && ws.workspaceId) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/" ? from : "/inbox"} replace />;
  }
  if (user) return <Onboarding />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        await signInWithPassword(email.trim(), password);
      } else if (mode === "forgot") {
        await requestPasswordReset(email.trim());
        setInfo("Se este e-mail tiver acesso, você vai receber um link para definir uma nova senha.");
      } else {
        const { needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation) setInfo("Enviamos um link de confirmação para o seu e-mail.");
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
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
          {mode !== "forgot" && (
            <Input
              label="Senha"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Entrar" : mode === "forgot" ? "Enviar link" : "Criar conta"}
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
        {mode !== "login" ? (
          <button type="button" className="font-medium text-brand" onClick={() => setMode("login")}>
            Voltar para o login
          </button>
        ) : signupEnabled ? (
          <>
            Ainda não tem acesso?{" "}
            <button type="button" className="font-medium text-brand" onClick={() => setMode("signup")}>
              Criar conta
            </button>
          </>
        ) : (
          "O acesso é criado por um administrador do workspace."
        )}
      </p>
    </Shell>
  );
}
