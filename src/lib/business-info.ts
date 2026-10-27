// Dados cadastrais e de pagamento (workspace_business_info) e a prévia do que a MarIA envia ao hóspede.

export type AccountType = "corrente" | "poupanca" | "pagamento";
export type PixKeyType = "cnpj" | "cpf" | "telefone" | "email" | "aleatoria";

export interface BusinessInfo {
  legal_name: string | null;
  cnpj: string | null;
  state_registration: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_code: string | null;
  agency: string | null;
  account: string | null;
  account_type: AccountType | null;
  payee_name: string | null;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
  deposit_percent: number | null;
  payment_instructions: string | null;
  /** Formulário de pré-reserva do PMS: no PIX, a MarIA envia este link em vez da chave. */
  pre_reservation_url: string | null;
  /** CNAE principal, só dígitos (7). */
  cnae_code: string | null;
  cnae_description: string | null;
  share_payment_info: boolean;
}

export const EMPTY_BUSINESS_INFO: BusinessInfo = {
  legal_name: null, cnpj: null, state_registration: null, address: null, phone: null, email: null,
  bank_name: null, bank_code: null, agency: null, account: null, account_type: null, payee_name: null,
  pix_key_type: null, pix_key: null, deposit_percent: null, payment_instructions: null, pre_reservation_url: null, cnae_code: null, cnae_description: null, share_payment_info: false,
};

export const PIX_LABEL: Record<PixKeyType, string> = { cnpj: "CNPJ", cpf: "CPF", telefone: "telefone", email: "e-mail", aleatoria: "chave aleatória" };
export const ACCOUNT_LABEL: Record<AccountType, string> = { corrente: "corrente", poupanca: "poupança", pagamento: "pagamento" };

/** 11222333000181 → 11.222.333/0001-81 (aceita digitação parcial). */
export function maskCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** 5510802 → 5510-8/02 (aceita digitação parcial). */
export function formatCnae(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 7);
  return d.replace(/^(\d{4})(\d)/, "$1-$2").replace(/^(\d{4}-\d)(\d{1,2})/, "$1/$2");
}

export interface CnpjLookup {
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  cnae_code: string | null;
  cnae_description: string | null;
}

interface BrasilApiCnpj {
  razao_social?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
}

/** Dados públicos do CNPJ (BrasilAPI, base da Receita Federal). Só lê; quem decide o que salvar é o formulário. */
export async function lookupCnpj(cnpj: string, fetchImpl: typeof fetch = fetch): Promise<CnpjLookup> {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) throw new Error("Informe o CNPJ completo (14 dígitos).");
  let res: Response;
  try {
    res = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  } catch {
    throw new Error("Não foi possível consultar o CNPJ agora. Tente de novo em instantes.");
  }
  if (res.status === 404) throw new Error("CNPJ não encontrado na Receita Federal.");
  if (!res.ok) throw new Error("Não foi possível consultar o CNPJ agora. Tente de novo em instantes.");
  const d = (await res.json()) as BrasilApiCnpj;
  const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
  const cep = clean(d.cep)?.replace(/\D/g, "").replace(/^(\d{5})(\d{3})$/, "$1-$2") ?? null;
  const street = [clean(d.logradouro), clean(d.numero)].filter(Boolean).join(", ");
  const city = [clean(d.municipio), clean(d.uf)].filter(Boolean).join("/");
  const address = [street + (clean(d.complemento) ? ` - ${clean(d.complemento)}` : ""), clean(d.bairro), city, cep && `CEP ${cep}`].filter(Boolean).join(", ") || null;
  const tel = clean(d.ddd_telefone_1)?.replace(/\D/g, "") ?? "";
  const phone = tel.length >= 10 ? `(${tel.slice(0, 2)}) ${tel.slice(2, -4)}-${tel.slice(-4)}` : null;
  const cnae = String(d.cnae_fiscal ?? "").replace(/\D/g, "");
  return {
    legal_name: clean(d.razao_social),
    address,
    phone,
    email: clean(d.email)?.toLowerCase() ?? null,
    cnae_code: cnae.length === 7 ? cnae : null,
    cnae_description: clean(d.cnae_fiscal_descricao),
  };
}

/** Mesmo formato que o agente usa (formatPaymentInfo no backend). */
export function paymentPreview(info: BusinessInfo): string[] {
  const lines: string[] = [];
  if (info.pre_reservation_url) {
    lines.push("Cartão de crédito: pelo link de reserva com as datas");
    lines.push(`PIX: pré-reserva em ${info.pre_reservation_url}`);
    lines.push("A equipe confirma a vaga e envia os dados do PIX (a MarIA não envia chave nem conta).");
    lines.push(info.deposit_percent ? `Sinal para garantir a reserva: ${String(info.deposit_percent).replace(".", ",")}% do total` : "Sinal: informado pela equipe");
    if (info.payment_instructions?.trim()) lines.push(info.payment_instructions.trim());
    return lines;
  }
  if (info.pix_key) lines.push(`PIX (${info.pix_key_type ? PIX_LABEL[info.pix_key_type] : "chave"}): ${info.pix_key}`);
  const payee = info.payee_name || info.legal_name;
  if (payee) lines.push(`Favorecido: ${payee}${info.cnpj ? ` — CNPJ ${info.cnpj}` : ""}`);
  if (info.bank_name || info.agency || info.account) {
    const parts = [
      info.bank_name && `${info.bank_name}${info.bank_code ? ` (${info.bank_code})` : ""}`,
      info.agency && `agência ${info.agency}`,
      info.account && `conta ${info.account_type ? `${ACCOUNT_LABEL[info.account_type]} ` : ""}${info.account}`,
    ].filter(Boolean);
    lines.push(`Transferência: ${parts.join(", ")}`);
  }
  if (info.deposit_percent) lines.push(`Sinal para garantir a reserva: ${String(info.deposit_percent).replace(".", ",")}% do total`);
  else lines.push("Sinal: informado pela equipe");
  if (info.payment_instructions?.trim()) lines.push(info.payment_instructions.trim());
  return lines;
}
