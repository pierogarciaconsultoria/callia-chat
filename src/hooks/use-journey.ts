import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/lib/workspace";
import { isDefaultPersona } from "@/lib/agent-setup";
import { readLocal, writeLocal } from "@/lib/storage";
import { useAgentConfig } from "@/hooks/use-agent-config";
import { findIntegration, useIntegrations } from "@/hooks/use-integrations";
import { buildJourney, readHidden, readSkipped, testedKey, writeHidden, writeSkipped, type Journey } from "@/lib/onboarding";

const SYNC = "callia:journey";
export const journeyKey = (ws: string) => ["journey", ws] as const;

/** Simulador usado: marca a etapa de teste e atualiza a jornada em todas as telas. */
export function markJourneyTested(ws: string) {
  writeLocal(testedKey(ws), "1");
  window.dispatchEvent(new Event(SYNC));
}

interface Counts { businessInfo: boolean; ownKnowledge: number; members: number; conversations: number; runs: number }

/** Jornada de configuração do workspace atual (só para admins). */
export function useJourney(): { journey: Journey | null; hidden: boolean; setHidden: (v: boolean) => void; skip: (id: string) => void } {
  const { workspaceId, isAdmin } = useWorkspace();
  const ws = workspaceId ?? "";
  const enabled = isAdmin && Boolean(workspaceId);
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => {
      setTick((t) => t + 1);
      void qc.invalidateQueries({ queryKey: journeyKey(ws) });
    };
    window.addEventListener(SYNC, on);
    return () => window.removeEventListener(SYNC, on);
  }, [qc, ws]);

  const config = useAgentConfig(ws);
  const integrations = useIntegrations(workspaceId, enabled);
  const counts = useQuery({
    queryKey: journeyKey(ws),
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<Counts> => {
      const head = { count: "exact" as const, head: true };
      const [info, own, policies, members, conversations, runs] = await Promise.all([
        supabase.from("workspace_business_info").select("legal_name, cnpj").eq("workspace_id", ws).maybeSingle(),
        supabase.from("knowledge_sources").select("id", head).eq("workspace_id", ws).in("kind", ["text", "document", "url"]),
        supabase.from("workspace_policies").select("id", head).eq("workspace_id", ws).eq("active", true),
        supabase.from("workspace_members").select("user_id", head).eq("workspace_id", ws),
        supabase.from("conversations").select("id", head).eq("workspace_id", ws),
        supabase.from("agent_runs").select("id", head).eq("workspace_id", ws).eq("status", "replied"),
      ]);
      const row = info.data as { legal_name: string | null; cnpj: string | null } | null;
      return {
        businessInfo: Boolean(row?.legal_name?.trim() || row?.cnpj?.trim()),
        // Políticas contam como conteúdo próprio (substituem os textos de políticas na base).
        ownKnowledge: (own.count ?? 0) + (policies.count ?? 0),
        members: members.count ?? 0,
        conversations: conversations.count ?? 0,
        runs: runs.count ?? 0,
      };
    },
  });

  const journey = useMemo(() => {
    if (!enabled || !counts.data || !config.data || integrations.isLoading) return null;
    const connected = (kind: Parameters<typeof findIntegration>[1]) => findIntegration(integrations.data, kind)?.status === "connected";
    const booking = findIntegration(integrations.data, "booking_link");
    return buildJourney({
      businessInfo: counts.data.businessInfo,
      agentGenerated: !isDefaultPersona(config.data.persona_prompt),
      segment: config.data.segment_id ?? null,
      ownKnowledge: counts.data.ownKnowledge,
      bookingConnected: connected("hospedin") || connected("hbook") || Boolean(booking?.details.booking_link) || booking?.status === "connected",
      tested: readLocal(testedKey(ws)) === "1" || counts.data.runs > 0,
      whatsapp: connected("whatsapp"),
      members: counts.data.members,
      conversations: counts.data.conversations,
    }, readSkipped(ws));
    // tick: relê pulos e o teste do simulador gravados no navegador.
  }, [enabled, counts.data, config.data, integrations.data, integrations.isLoading, ws, tick]);

  const setHidden = useCallback((v: boolean) => {
    writeHidden(ws, v);
    window.dispatchEvent(new Event(SYNC));
  }, [ws]);
  const skip = useCallback((id: string) => {
    const s = readSkipped(ws);
    s.add(id);
    writeSkipped(ws, s);
    window.dispatchEvent(new Event(SYNC));
  }, [ws]);

  // tick também atualiza "oculta" entre a barra e o painel.
  void tick;
  return { journey, hidden: enabled ? readHidden(ws) : true, setHidden, skip };
}
