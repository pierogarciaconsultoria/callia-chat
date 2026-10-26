import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, QrCode, RefreshCw } from "lucide-react";
import { Button, CopyButton, Input, Modal, Notice, Spinner, Tabs } from "@/components/ui";
import { errorMessage } from "@/lib/functions";
import { formatPhone } from "@/lib/format";
import { maskBrPhone, phoneDigits } from "@/lib/integrations";
import type { WhatsAppInstance } from "@/lib/database.types";
import { useInstanceMutations, useWhatsAppInstances } from "@/hooks/use-whatsapp-instances";
import { useIntegrationActions } from "@/hooks/use-integrations";

type Method = "qr" | "code";

const isMobileWidth = () => {
  try {
    return window.matchMedia("(max-width: 640px)").matches;
  } catch {
    return false;
  }
};

/**
 * Conexão guiada do WhatsApp: QR Code (computador) ou código de 8 dígitos (celular).
 * Usa a instância padrão (ou cria "WhatsApp principal") e acompanha até o status "open".
 */
export function WhatsAppConnectModal({
  open,
  onClose,
  workspaceId,
  replace = false,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Trocar número: desconecta o atual antes de gerar o novo QR/código. */
  replace?: boolean;
}) {
  const [method, setMethod] = useState<Method>(() => (isMobileWidth() ? "code" : "qr"));
  const [started, setStarted] = useState<Method | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const replacedRef = useRef(false);

  const instances = useWhatsAppInstances(workspaceId, { refetchInterval: open && started ? 3000 : false });
  const { create, action } = useInstanceMutations(workspaceId);
  const integrations = useIntegrationActions(workspaceId);

  const target: WhatsAppInstance | undefined =
    instances.data?.find((i) => i.id === instanceId) ?? instances.data?.find((i) => i.is_default) ?? instances.data?.[0];
  const connected = Boolean(started && target && target.status === "open");

  // Reinicia o fluxo a cada abertura.
  useEffect(() => {
    if (!open) return;
    setStarted(null);
    setPairingCode(null);
    setQr(null);
    setError(null);
    setInstanceId(null);
    replacedRef.current = false;
  }, [open]);

  // Enquanto aguarda a leitura, sincroniza o estado com a Evolution (o QR também chega pelo webhook).
  useEffect(() => {
    if (!open || !started || !target?.id || connected) return;
    const id = target.id;
    const timer = window.setInterval(() => {
      action.mutate({ action: "refresh", instance_id: id });
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started, target?.id, connected]);

  useEffect(() => {
    if (connected) integrations.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // QR mais recente: o que veio na resposta ou o atualizado no banco pelo webhook.
  const qrImage = target?.qr_code ?? qr;

  async function start(selected: Method, digits?: string) {
    setBusy(true);
    setError(null);
    setPairingCode(null);
    try {
      let current = target;
      if (replace && current && !replacedRef.current && current.status === "open") {
        await action.mutateAsync({ action: "disconnect", instance_id: current.id });
        replacedRef.current = true;
      }
      const res = current
        ? await action.mutateAsync({ action: "connect", instance_id: current.id, ...(digits ? { phone: digits } : {}) })
        : await create.mutateAsync({ name: "WhatsApp principal", make_default: true, ...(digits ? { phone: digits } : {}) });
      current = res.instance ?? current;
      if (current) setInstanceId(current.id);
      setQr(res.qr_code ?? null);
      setPairingCode(res.pairing_code ?? null);
      setStarted(selected);
      if (selected === "code" && !res.pairing_code) {
        setError(new Error("O WhatsApp não gerou o código agora. Tente de novo em alguns segundos ou use o QR Code."));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const digits = phoneDigits(phone);
    if (digits) void start("code", digits);
  }

  const footer = connected ? (
    <Button onClick={onClose}>Concluir</Button>
  ) : (
    <Button variant="secondary" onClick={onClose}>
      Fechar
    </Button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={replace ? "Trocar o número do WhatsApp" : "Conectar WhatsApp"}
      description="Use o celular do número que vai atender os hóspedes."
      footer={footer}
    >
      {connected && target ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <p className="text-lg font-semibold">Conectado!</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {target.phone_number ? `${formatPhone(target.phone_number)} ` : ""}
            {target.profile_name ? `(${target.profile_name}) ` : ""}
            já está recebendo mensagens.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Mande um "oi" de outro número para testar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Tabs<Method>
            tabs={[
              { id: "qr", label: <span className="inline-flex items-center gap-1.5"><QrCode className="h-4 w-4" /> Ler QR Code</span> },
              { id: "code", label: <span className="inline-flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Usar código</span> },
            ]}
            value={method}
            onChange={(m) => {
              setMethod(m);
              setError(null);
            }}
          />

          {error != null && <Notice tone="warn">{errorMessage(error)}</Notice>}

          {method === "qr" ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
                <li>Abra o WhatsApp no celular.</li>
                <li>Toque em <b>Configurações</b> (iPhone) ou no menu <b>⋮</b> (Android).</li>
                <li>Toque em <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>.</li>
                <li>Aponte a câmera para o QR Code ao lado.</li>
              </ol>
              <div className="flex flex-col items-center gap-2">
                {started === "qr" && qrImage ? (
                  <img src={qrImage} alt="QR Code para conectar o WhatsApp" className="h-60 w-60 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700" />
                ) : (
                  <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
                    {busy || started === "qr" ? <Spinner /> : (
                      <Button onClick={() => void start("qr")}>
                        <QrCode className="h-4 w-4" /> Gerar QR Code
                      </Button>
                    )}
                  </div>
                )}
                {started === "qr" && (
                  <>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner /> Aguardando a leitura…</p>
                    <Button size="sm" variant="ghost" onClick={() => void start("qr")} loading={busy}>
                      <RefreshCw className="h-3.5 w-3.5" /> Gerar novo QR
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!pairingCode ? (
                <form onSubmit={submitCode} className="space-y-3">
                  <Input
                    label="Número do WhatsApp (com DDD)"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(48) 99999-0000"
                    value={phone}
                    onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                    hint="O mesmo número do celular que vai atender."
                    error={phone && !phoneDigits(phone) ? "Informe DDD + número" : undefined}
                  />
                  <Button type="submit" loading={busy} disabled={!phoneDigits(phone)}>
                    Gerar código
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
                    <span className="font-mono text-3xl font-semibold tracking-[0.3em]">{pairingCode}</span>
                    <CopyButton value={pairingCode} />
                  </div>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
                    <li>No WhatsApp, abra <b>Aparelhos conectados</b>.</li>
                    <li>Toque em <b>Conectar um aparelho</b>.</li>
                    <li>Toque em <b>Conectar com número de telefone</b>.</li>
                    <li>Digite o código acima.</li>
                  </ol>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner /> Aguardando a confirmação no celular…</p>
                    <Button size="sm" variant="ghost" onClick={() => setPairingCode(null)}>
                      Gerar outro código
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
