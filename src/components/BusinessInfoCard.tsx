import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequiredWorkspace } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { Link } from "react-router-dom";
import { EMPTY_BUSINESS_INFO, formatCnae, lookupCnpj, maskCnpj, paymentPreview, type AccountType, type BusinessInfo, type PixKeyType } from "@/lib/business-info";
import { resolveSegmentFromCnae } from "@/lib/segments";
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Select, Spinner, Switch, Textarea, useToast } from "@/components/ui";

type TextField = Exclude<keyof BusinessInfo, "deposit_percent" | "share_payment_info" | "account_type" | "pix_key_type">;
interface FormState { text: Record<TextField, string>; account_type: AccountType | ""; pix_key_type: PixKeyType | ""; deposit: string; share: boolean }

const TEXT_FIELDS: TextField[] = ["legal_name", "cnpj", "state_registration", "address", "phone", "email", "cnae_code", "cnae_description", "bank_name", "bank_code", "agency", "account", "payee_name", "pix_key", "payment_instructions", "pre_reservation_url"];

function toForm(info: BusinessInfo): FormState {
  return {
    text: Object.fromEntries(TEXT_FIELDS.map((f) => [f, f === "cnae_code" ? formatCnae(info[f] ?? "") : info[f] ?? ""])) as Record<TextField, string>,
    account_type: info.account_type ?? "",
    pix_key_type: info.pix_key_type ?? "",
    deposit: info.deposit_percent !== null && info.deposit_percent !== undefined ? String(info.deposit_percent).replace(".", ",") : "",
    share: info.share_payment_info,
  };
}

function parseDeposit(value: string): number | null | "invalid" {
  const v = value.trim().replace("%", "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 100 : "invalid";
}

function fromForm(form: FormState, deposit: number | null): BusinessInfo {
  const text = Object.fromEntries(TEXT_FIELDS.map((f) => [f, (f === "cnae_code" ? form.text[f].replace(/\D/g, "") : form.text[f].trim()) || null])) as Record<TextField, string | null>;
  return { ...text, account_type: form.account_type || null, pix_key_type: form.pix_key_type || null, deposit_percent: deposit, share_payment_info: form.share };
}

/** Dados cadastrais e bancários que a MarIA informa ao hóspede para pagar o sinal da reserva. */
export function BusinessInfoCard() {
  const { workspaceId } = useRequiredWorkspace();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["business-info", workspaceId],
    queryFn: async () => {
      const row = unwrap(await supabase.from("workspace_business_info").select("*").eq("workspace_id", workspaceId).maybeSingle()) as Partial<BusinessInfo> | null;
      return { ...EMPTY_BUSINESS_INFO, ...(row ?? {}) } as BusinessInfo;
    },
  });
  const [form, setForm] = useState<FormState>(() => toForm(EMPTY_BUSINESS_INFO));
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const deposit = parseDeposit(form.deposit);
  const preview = useMemo(() => paymentPreview(fromForm(form, deposit === "invalid" ? null : deposit)), [form, deposit]);
  const preReservationInvalid = Boolean(form.text.pre_reservation_url.trim()) && !/^https:\/\/\S+$/.test(form.text.pre_reservation_url.trim());
  const hasPaymentData = Boolean(form.text.pix_key.trim() || form.text.account.trim() || form.text.pre_reservation_url.trim());
  const cnaeDigits = form.text.cnae_code.replace(/\D/g, "");
  const cnaeInvalid = cnaeDigits.length > 0 && cnaeDigits.length !== 7;
  const suggestedSegment = cnaeDigits.length === 7 ? resolveSegmentFromCnae(cnaeDigits) : undefined;
  const dirty = query.data ? JSON.stringify(toForm(query.data)) !== JSON.stringify(form) : false;

  const setText = (field: TextField) => (e: { target: { value: string } }) =>
    setForm((f) => ({
      ...f,
      text: { ...f.text, [field]: field === "cnpj" ? maskCnpj(e.target.value) : field === "cnae_code" ? formatCnae(e.target.value) : e.target.value },
    }));

  // Preenche só os campos vazios (o que o dono digitou fica); o CNAE vem sempre da Receita.
  async function fillFromCnpj() {
    setLooking(true);
    try {
      const found = await lookupCnpj(form.text.cnpj);
      setForm((f) => {
        const text = { ...f.text };
        for (const k of ["legal_name", "address", "phone", "email"] as const) if (!text[k].trim() && found[k]) text[k] = found[k]!;
        if (found.cnae_code) text.cnae_code = formatCnae(found.cnae_code);
        if (found.cnae_description) text.cnae_description = found.cnae_description;
        return { ...f, text };
      });
      toast.success("Dados da Receita preenchidos. Confira e salve.");
    } catch (err) {
      toast.error(err);
    } finally {
      setLooking(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (deposit === "invalid" || preReservationInvalid || cnaeInvalid) return;
    setBusy(true);
    try {
      unwrap(await supabase.from("workspace_business_info").upsert({ workspace_id: workspaceId, ...fromForm(form, deposit) }, { onConflict: "workspace_id" }));
      await queryClient.invalidateQueries({ queryKey: ["business-info", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["business-info-cnae", workspaceId] });
      toast.success("Dados da empresa salvos.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Dados da empresa e pagamento" description="Dados cadastrais e bancários que a MarIA usa para orientar o pagamento do sinal da reserva." />
      {query.isLoading ? (
        <CardBody className="flex justify-center"><Spinner /></CardBody>
      ) : query.error ? (
        <CardBody><ErrorState error={query.error} onRetry={() => void query.refetch()} /></CardBody>
      ) : (
        <CardBody>
          <form onSubmit={submit} className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Empresa</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Razão social" value={form.text.legal_name} onChange={setText("legal_name")} maxLength={200} />
                <div className="flex items-end gap-2">
                  <Input label="CNPJ" inputMode="numeric" placeholder="00.000.000/0000-00" value={form.text.cnpj} onChange={setText("cnpj")} wrapperClassName="flex-1" />
                  <Button type="button" variant="secondary" onClick={() => void fillFromCnpj()} loading={looking} disabled={form.text.cnpj.replace(/\D/g, "").length !== 14}>
                    Buscar
                  </Button>
                </div>
                <Input label="Inscrição estadual" value={form.text.state_registration} onChange={setText("state_registration")} maxLength={40} />
                <Input label="Telefone" type="tel" value={form.text.phone} onChange={setText("phone")} maxLength={40} />
                <Input label="E-mail" type="email" value={form.text.email} onChange={setText("email")} maxLength={200} />
                <Input label="Endereço" value={form.text.address} onChange={setText("address")} maxLength={300} />
                <Input
                  label="CNAE principal"
                  inputMode="numeric"
                  placeholder="0000-0/00"
                  value={form.text.cnae_code}
                  onChange={setText("cnae_code")}
                  error={cnaeInvalid ? "O CNAE tem 7 dígitos (ex.: 5510-8/02)." : undefined}
                  hint={form.text.cnae_description || "Preenchido pelo botão Buscar ou digitado."}
                />
              </div>
              {suggestedSegment && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Segmento sugerido pelo CNAE: <strong className="text-slate-700 dark:text-slate-300">{suggestedSegment.label}</strong>. Escolha ou confirme em{" "}
                  <Link to="/agent" className="text-brand underline">Agente de IA</Link>.
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Conta bancária</legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <Input label="Banco" placeholder="ex.: Banco do Brasil" value={form.text.bank_name} onChange={setText("bank_name")} maxLength={80} />
                <Input label="Código" inputMode="numeric" placeholder="001" value={form.text.bank_code} onChange={setText("bank_code")} maxLength={10} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Agência" value={form.text.agency} onChange={setText("agency")} maxLength={20} />
                <Input label="Conta" value={form.text.account} onChange={setText("account")} maxLength={30} />
                <Select label="Tipo de conta" value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value as AccountType | "" }))}>
                  <option value="">—</option>
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                  <option value="pagamento">Pagamento</option>
                </Select>
              </div>
              <Input label="Favorecido" hint="Opcional — se vazio, usa a razão social." value={form.text.payee_name} onChange={setText("payee_name")} maxLength={200} />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">PIX e sinal</legend>
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <Select label="Tipo de chave PIX" value={form.pix_key_type} onChange={(e) => setForm((f) => ({ ...f, pix_key_type: e.target.value as PixKeyType | "" }))}>
                  <option value="">—</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="cpf">CPF</option>
                  <option value="telefone">Telefone</option>
                  <option value="email">E-mail</option>
                  <option value="aleatoria">Aleatória</option>
                </Select>
                <Input label="Chave PIX" value={form.text.pix_key} onChange={setText("pix_key")} maxLength={140} />
              </div>
              <Input
                label="Link de pré-reserva (PIX)"
                type="url"
                placeholder="https://pms.hospedin.com/pre-reserva/sua-pousada"
                hint="Com o link, no PIX a MarIA envia a pré-reserva: a equipe confirma a vaga e depois passa a chave. Sem ele, a MarIA envia a chave PIX acima."
                error={preReservationInvalid ? "Use um endereço completo começando com https://" : undefined}
                value={form.text.pre_reservation_url}
                onChange={setText("pre_reservation_url")}
                maxLength={500}
              />
              <Input
                wrapperClassName="sm:max-w-[12rem]"
                label="Sinal (%)"
                inputMode="decimal"
                placeholder="ex.: 50"
                hint="Vazio = a equipe informa o sinal."
                error={deposit === "invalid" ? "Informe um percentual entre 0 e 100." : undefined}
                value={form.deposit}
                onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
              />
              <Textarea
                label="Instruções de pagamento"
                rows={3}
                placeholder="ex.: Envie o comprovante por aqui para confirmarmos a reserva."
                value={form.text.payment_instructions}
                onChange={setText("payment_instructions")}
                maxLength={1000}
              />
            </fieldset>

            <Switch
              checked={form.share}
              onChange={(share) => setForm((f) => ({ ...f, share }))}
              label="A MarIA pode enviar os dados de pagamento ao hóspede"
              description={
                form.share
                  ? "Quando o hóspede quiser reservar, a MarIA envia o PIX e/ou a conta acima com o valor do sinal."
                  : "Desligado: a MarIA não envia dados bancários nem PIX — ela avisa que a equipe enviará os dados de pagamento."
              }
            />
            {form.share && !hasPaymentData && <p className="text-sm text-amber-700 dark:text-amber-400">Preencha a chave PIX ou a conta bancária para a MarIA ter o que enviar.</p>}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Como a MarIA vai enviar</p>
              {form.share ? (
                hasPaymentData ? (
                  <div className="space-y-0.5 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-200">{preview.map((line, i) => <p key={i}>{line}</p>)}</div>
                ) : (
                  <p className="text-sm text-slate-500">Sem PIX nem conta cadastrados — a MarIA dirá que a equipe envia os dados de pagamento.</p>
                )
              ) : (
                <p className="text-sm text-slate-500">"Para garantir sua reserva, nossa equipe vai te enviar os dados de pagamento em instantes."</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={busy} disabled={!dirty || deposit === "invalid" || preReservationInvalid}>Salvar dados</Button>
            </div>
          </form>
        </CardBody>
      )}
    </Card>
  );
}
