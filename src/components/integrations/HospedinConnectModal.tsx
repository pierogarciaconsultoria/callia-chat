import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, PackagePlus } from "lucide-react";
import { Button, Input, Modal, Notice, useToast } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/functions";
import type { AvailabilityTest, Integration } from "@/lib/database.types";
import { useIntegrationActions } from "@/hooks/use-integrations";
import { AvailabilityTable } from "./AvailabilityTest";

type Step = "form" | "result";

function needsAccountId(err: unknown): boolean {
  const details = err instanceof ApiError ? (err.details as { needs?: string } | undefined) : undefined;
  return details?.needs === "account_id";
}

/** Conexão com o Hospedin: só e-mail e senha; o Callia descobre a conta, testa e mostra os valores para conferência. */
export function HospedinConnectModal({
  open,
  onClose,
  workspaceId,
  current,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  current?: Integration;
}) {
  const toast = useToast();
  const { connectHospedin, test, setPriceUnit, syncCatalog } = useIntegrationActions(workspaceId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountId, setAccountId] = useState("");
  const [askAccount, setAskAccount] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [result, setResult] = useState<AvailabilityTest | null>(null);
  const [unit, setUnit] = useState<"reais" | "cents">("reais");
  const [imported, setImported] = useState(false);

  useEffect(() => {
    if (!open) return;
    // A senha nunca é preenchida: o Callia guarda cifrada e não devolve.
    setPassword("");
    setStep("form");
    setResult(null);
    setImported(false);
    setAskAccount(false);
    setAccountId(current?.details.account_id ?? "");
    setUnit(current?.details.price_unit ?? "reais");
    connectHospedin.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await connectHospedin.mutateAsync({
        email: email.trim(),
        password,
        ...(askAccount && accountId.trim() ? { account_id: accountId.trim() } : {}),
      });
      setPassword("");
      setUnit(res.integration.details.price_unit ?? "reais");
      setResult(res.test);
      setStep("result");
    } catch (err) {
      if (needsAccountId(err)) setAskAccount(true);
    }
  }

  async function fixUnit() {
    const next = unit === "reais" ? "cents" : "reais";
    try {
      await setPriceUnit.mutateAsync(next);
      setUnit(next);
      const res = await test.mutateAsync({ kind: "hospedin" });
      setResult(res.test);
      toast.success("Unidade dos valores corrigida.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function importCatalog() {
    try {
      const res = await syncCatalog.mutateAsync();
      setImported(true);
      toast.success(`Catálogo atualizado: ${res.created} categoria(s) nova(s), ${res.updated} atualizada(s).`);
    } catch (err) {
      toast.error(err);
    }
  }

  const connectError = connectHospedin.error && !needsAccountId(connectHospedin.error) ? connectHospedin.error : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={current?.status === "connected" ? "Reconectar o Hospedin" : "Conectar o Hospedin"}
      description="A MarIA passa a consultar disponibilidade e valores direto no seu sistema de reservas."
      size={step === "result" ? "lg" : "md"}
      footer={
        step === "result" ? (
          <Button onClick={onClose}>Concluir</Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      {step === "form" ? (
        <form onSubmit={submit} className="space-y-4">
          <Notice>
            Recomendamos criar no Hospedin um usuário só para o Callia, com permissão de leitura de tarifas e disponibilidade. A senha fica
            guardada criptografada e não aparece mais no painel.
          </Notice>
          <Input label="E-mail do usuário no Hospedin" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Senha" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {askAccount && (
            <div className="space-y-2">
              <Notice tone="warn">
                Não conseguimos descobrir a sua conta automaticamente. Informe o identificador: ele aparece no endereço do Hospedin depois do login
                (por exemplo, em <code>pms.hospedin.com/<b>identificador</b>/…</code>).
              </Notice>
              <Input label="Identificador da conta" value={accountId} onChange={(e) => setAccountId(e.target.value)} required />
            </div>
          )}
          {connectError != null && <Notice tone="warn">{errorMessage(connectError)}</Notice>}
          <Button type="submit" loading={connectHospedin.isPending} disabled={!email.trim() || !password || (askAccount && !accountId.trim())}>
            Conectar e testar
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Hospedin conectado.</span>
          </div>
          {result ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">Fizemos uma consulta de teste para o próximo fim de semana:</p>
              <AvailabilityTable data={result} />
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-sm font-medium">Os valores estão certos?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={onClose}>
                    Sim, está certo
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void fixUnit()} loading={setPriceUnit.isPending || test.isPending}>
                    Os valores estão 100× {unit === "reais" ? "maiores" : "menores"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <Notice>Conexão feita, mas a consulta de teste não trouxe resultado. Use "Testar" no cartão do Hospedin para tentar outras datas.</Notice>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Importe as categorias de quarto do Hospedin para o catálogo da MarIA (nome e capacidade).
            </p>
            <Button size="sm" variant="secondary" onClick={() => void importCatalog()} loading={syncCatalog.isPending} disabled={imported}>
              <PackagePlus className="h-4 w-4" /> {imported ? "Importado" : "Importar categorias para o catálogo"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
