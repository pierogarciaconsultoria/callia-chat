import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/functions";
import { Button, Card, Input, PageLoader } from "@/components/ui";
import { TermsCheckbox } from "@/components/TermsCheckbox";
import { Shell } from "./Login";

// Destino dos links de convite e de recuperação de senha enviados por e-mail.
export default function SetPassword() {
  const { user, loading, updatePassword, acceptTerms, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <PageLoader />;
  if (!user) {
    return (
      <Shell>
        <Card className="p-5 text-sm">
          <h2 className="text-base font-semibold">Link inválido ou expirado</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Peça um novo link em "Esqueci minha senha" na tela de login.
          </p>
          <Link to="/entrar" className="mt-4 inline-block font-medium text-brand">Ir para o login</Link>
        </Card>
      </Shell>
    );
  }

  // Convidado pela equipe ainda não aceitou os Termos; quem só está trocando a senha já aceitou no cadastro.
  const needsTerms = !user.user_metadata?.terms_accepted_at;
  // Convidado sem nome (o admin não informou no convite): pede o nome aqui.
  const needsName = !String(user.user_metadata?.full_name ?? "").trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    if (needsTerms && !accepted) {
      setError("Para continuar, aceite os Termos de Uso e a Política de Privacidade.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      if (needsName) await updateProfile(fullName);
      if (needsTerms) await acceptTerms();
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Defina sua senha</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Acesso de {user.email}.</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          {needsName && <Input label="Seu nome" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={80} hint="Como você aparece para a equipe." />}
          <Input label="Nova senha" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Input label="Confirme a senha" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {needsTerms && <TermsCheckbox checked={accepted} onChange={setAccepted} />}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>Salvar senha</Button>
        </form>
      </Card>
    </Shell>
  );
}
