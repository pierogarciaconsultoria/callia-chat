export type PaymentLink = {
  label: string;
  url: string;
};

export function serializePaymentLinks(links: PaymentLink[]) {
  return links.map((link) => `${link.label || "Link"} | ${link.url || ""}`).join("\n");
}

export function parsePaymentLinks(value: string): PaymentLink[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, url] = line.split("|").map((item) => item.trim());
      return {
        label: label || "Link",
        url: url || label || "",
      };
    });
}

export function serializeFollowUpRules(value: unknown[]) {
  return JSON.stringify(value ?? [], null, 2);
}

export function parseFollowUpRules(value: string) {
  const parsed = value.trim() ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed : [];
}

export function normalizeCustomDomain(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
