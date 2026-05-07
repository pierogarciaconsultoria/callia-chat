export type WhatsAppStatus = "disconnected" | "connecting" | "qr" | "connected" | "error";

export type WhatsAppInstanceRecord = {
  id: string;
  workspace_id: string;
  instance_name: string;
  display_name: string | null;
  status: WhatsAppStatus;
  phone_number: string | null;
  qr_code: string | null;
  evolution_base_url: string | null;
  webhook_token: string;
  last_seen_at: string | null;
  provider_type: string;
  provider_secret_ref: string | null;
  is_default: boolean;
  connection_metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type WhatsAppInstanceForm = {
  display_name: string;
  instance_name: string;
  evolution_base_url: string;
  provider_secret_ref: string;
  phone_number: string;
  is_default: boolean;
};

export function getWhatsAppStatusMeta(status: WhatsAppStatus) {
  switch (status) {
    case "connected":
      return { label: "Conectado", variant: "default" as const };
    case "connecting":
      return { label: "Conectando", variant: "secondary" as const };
    case "qr":
      return { label: "Aguardando QR", variant: "secondary" as const };
    case "error":
      return { label: "Erro", variant: "destructive" as const };
    default:
      return { label: "Desconectado", variant: "outline" as const };
  }
}

export function createEmptyWhatsAppInstanceForm(): WhatsAppInstanceForm {
  return {
    display_name: "",
    instance_name: "",
    evolution_base_url: "",
    provider_secret_ref: "",
    phone_number: "",
    is_default: false,
  };
}

export function createWhatsAppInstanceForm(instance?: Partial<WhatsAppInstanceRecord>): WhatsAppInstanceForm {
  if (!instance) return createEmptyWhatsAppInstanceForm();

  return {
    display_name: instance.display_name ?? "",
    instance_name: instance.instance_name ?? "",
    evolution_base_url: instance.evolution_base_url ?? "",
    provider_secret_ref: instance.provider_secret_ref ?? "",
    phone_number: instance.phone_number ?? "",
    is_default: Boolean(instance.is_default),
  };
}

export function getQrCodeSrc(qrCode: string | null) {
  if (!qrCode) return null;
  if (qrCode.startsWith("data:image")) return qrCode;
  if (qrCode.startsWith("http://") || qrCode.startsWith("https://")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

export function getWebhookUrl(options: {
  supabaseUrl: string | undefined;
  instanceId: string;
  token: string;
}) {
  if (!options.supabaseUrl) return null;
  const base = options.supabaseUrl.replace(/\/+$/, "");
  return `${base}/functions/v1/whatsapp-webhook?instance_id=${options.instanceId}&token=${options.token}`;
}
