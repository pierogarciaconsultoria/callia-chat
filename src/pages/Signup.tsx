// Cadastro de uma nova empresa: cria a conta do dono com os dados do negócio nos metadados;
// o workspace nasce em /bem-vindo (create_workspace_from_signup) depois da confirmação do e-mail.
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { MailCheck, ShieldCheck } from "lucide-react";
import { useAuth, type SignupMetadata } from "@/lib/auth";
import { LEGAL_VERSION } from "@/lib/legal";
import { useSiteInfo } from "@/lib/site";
import { SEGMENT_LIST } from "@/lib/segments";
import { Button, Card, Input, Notice, PageLoader, Select } from "@/components/ui";
import { Shell, translateAuthError } from "./Login";

export default function Signup() {
  const { user, loading, signUp } = useAuth();
  const site = useSiteInfo();
  const [company, setCompany] = useState("");
  const [segment, setSegment] = useState("");
  const [website, setWebsite] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (loading || site.isLoading) return <PageLoader />;
  if (user || done) return <Navigate to="/bem-vindo" replace />;

  const trialDays = site.data?.trial_days ?? 14;

  if (!site.data?.self_service) {
    const support = site.data?.support_email;
    return (
      <Shell subtitle="Cadastro de nova empresa">
        <Card className="space-y-3 p-5 text-sm">
          <Notice tone="info">No momento o cadastro é feito por convite.</Notice>
          <p className="text-slate-600 dark:text-slate-400">
            {support ? (
              <>Fale com a gente em <a href={`mailto:${support}`} className="font-medium text-brand">{support}</a> e criamos a sua conta.</>
            ) : (
              "Peça a um administrador da plataforma para criar a sua conta."
            )}
          </p>
          <Link to="/entrar" className="block text-center font-medium text-brand">Já tenho conta</Link>
        </Card>
      </Shell>
    );
  }

  if (sentTo) {
    return (
      <Shell subtitle="Falta só confirmar o e-mail">
        <Card className="space-y-3 p-5 text-center text-sm">
          <MailCheck className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
          <p className="font-medium">Enviamos um link de confirmação para {sentTo}.</p>
          <p className="text-slate-600 dark:text-slate-400">
            Abra o e-mail e clique no link: você entra direto na configuração do atendimento de <strong>{company.trim()}</strong>.
          </p>
          <p className="text-xs text-slate-500">Não chegou? Confira a caixa de spam. O link vale por 24 horas.</p>
        </Card>
      </Shell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accepted) {
      setError("Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.");
      return;
    }
    setBusy(true);
    setError(null);
    const metadata: SignupMetadata = {
      company_name: company.trim(),
      ...(segment ? { segment } : {}),
      ...(website.trim() ? { website: website.trim() } : {}),
      ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
      terms_accepted_at: new Date().toISOString(),
      terms_version: LEGAL_VERSION,
    };
    try {
      const { needsConfirmation } = await signUp(email.trim(), password, metadata);
      if (needsConfirmation) setSentTo(email.trim());
      else setDone(true);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell subtitle={`Teste grátis por ${trialDays} dias. Sem cartão de crédito.`} wide>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome da empresa" value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" />
            <Select label="Segmento" value={segment} onChange={(e) => setSegment(e.target.value)} hint="Traz as boas práticas do setor para o agente.">
              <option value="">Escolher depois</option>
              {SEGMENT_LIST.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
            <Input label="Site (opcional)" type="url" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} autoComplete="url" hint="A IA lê o site para montar o agente." />
            <Input label="WhatsApp da empresa (opcional)" type="tel" placeholder="(48) 99999-0000" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} autoComplete="tel" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Seu e-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Senha" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required hint="Pelo menos 8 caracteres." />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
            <span>
              Li e aceito os <Link to="/termos" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Termos de Uso</Link> e a{" "}
              <Link to="/privacidade" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Política de Privacidade</Link>, inclusive o uso dos dados
              informados e das conversas do WhatsApp para operar o atendimento da minha empresa (LGPD).
            </span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>Criar conta grátis</Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Seu número continua seu: o WhatsApp é conectado por QR code, sem trocar de chip.
          </p>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-500">
        Já tem conta? <Link to="/entrar" className="font-medium text-brand">Entrar</Link>
      </p>
    </Shell>
  );
}
