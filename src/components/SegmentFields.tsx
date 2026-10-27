import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/functions";
import { formatCnae } from "@/lib/business-info";
import { EMOJI_POLICY_LABELS, getSegmentProfile, resolveSegmentFromCnae, SEGMENT_LIST, type EmojiPolicy } from "@/lib/segments";
import { Button, Notice, Select } from "@/components/ui";

interface Props {
  workspaceId: string;
  segmentId: string | null;
  emojiPolicy: EmojiPolicy | null;
  onChange: (patch: { segment_id?: string | null; emoji_policy?: EmojiPolicy | null }) => void;
}

/** Segmento do negócio: regras padrão do setor entre as da plataforma e as da empresa. */
export function SegmentFields({ workspaceId, segmentId, emojiPolicy, onChange }: Props) {
  const profile = getSegmentProfile(segmentId);
  const cnae = useQuery({
    queryKey: ["business-info-cnae", workspaceId],
    queryFn: async () =>
      unwrap(await supabase.from("workspace_business_info").select("cnae_code").eq("workspace_id", workspaceId).maybeSingle()) as { cnae_code: string | null } | null,
  });
  const suggested = !segmentId && cnae.data?.cnae_code ? resolveSegmentFromCnae(cnae.data.cnae_code) : undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Segmento do negócio"
          value={segmentId ?? ""}
          onChange={(e) => onChange({ segment_id: e.target.value || null })}
          hint="Acrescenta tom, boas práticas e regras obrigatórias do setor. A persona e os limites acima prevalecem."
        >
          <option value="">Nenhum</option>
          {SEGMENT_LIST.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>
        <Select
          label="Emojis"
          value={emojiPolicy ?? ""}
          onChange={(e) => onChange({ emoji_policy: (e.target.value || null) as EmojiPolicy | null })}
        >
          <option value="">{profile ? `Padrão do segmento (${EMOJI_POLICY_LABELS[profile.emoji].toLowerCase()})` : "Sem regra (o modelo decide)"}</option>
          {(Object.keys(EMOJI_POLICY_LABELS) as EmojiPolicy[]).map((p) => (
            <option key={p} value={p}>{EMOJI_POLICY_LABELS[p]}</option>
          ))}
        </Select>
      </div>
      {suggested && cnae.data?.cnae_code && (
        <Notice>
          <span className="flex flex-wrap items-center gap-2">
            Pelo CNAE {formatCnae(cnae.data.cnae_code)}, o segmento sugerido é <strong>{suggested.label}</strong>.
            <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ segment_id: suggested.id })}>Usar</Button>
          </span>
        </Notice>
      )}
      {profile && (
        <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">O que o segmento acrescenta ao agente</summary>
          <div className="mt-3 space-y-3 text-slate-600 dark:text-slate-400">
            <p><span className="font-medium text-slate-700 dark:text-slate-300">Tom:</span> {profile.tone}</p>
            <p><span className="font-medium text-slate-700 dark:text-slate-300">Objetivo:</span> {profile.goal}</p>
            <RuleList title="Boas práticas" items={profile.conduct} />
            {profile.mandatory.length > 0 && <RuleList title="Obrigatório (vale sempre)" items={profile.mandatory} />}
            <RuleList title="Transfere para a equipe quando" items={profile.escalation} />
          </div>
        </details>
      )}
    </div>
  );
}

function RuleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium text-slate-700 dark:text-slate-300">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}
