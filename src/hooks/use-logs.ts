import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

export function useLogs() {
  const { currentWorkspace, role } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<any[]>([]);
  const [publicApiRequests, setPublicApiRequests] = useState<any[]>([]);
  const [outboundMessages, setOutboundMessages] = useState<any[]>([]);

  const canView = role === "owner" || role === "admin";

  const refresh = useCallback(async () => {
    if (!currentWorkspace || !canView) {
      setAuditLogs([]);
      setWebhookDeliveries([]);
      setPublicApiRequests([]);
      setOutboundMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const workspaceId = currentWorkspace.id;

    const [auditRes, deliveryRes, apiRes, outboundRes] = await Promise.all([
      (supabase as any)
        .from("audit_logs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("webhook_deliveries")
        .select("*, webhook:webhooks(name, url)")
        .eq("workspace_id", workspaceId)
        .order("attempted_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("public_api_requests")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("outbound_messages")
        .select("*, message:messages(content, sender, type)")
        .eq("workspace_id", workspaceId)
        .order("queued_at", { ascending: false })
        .limit(100),
    ]);

    setAuditLogs(auditRes.data ?? []);
    setWebhookDeliveries(deliveryRes.data ?? []);
    setPublicApiRequests(apiRes.data ?? []);
    setOutboundMessages(outboundRes.data ?? []);
    setLoading(false);
  }, [canView, currentWorkspace]);

  useEffect(() => {
    refresh().catch(() => {
      setLoading(false);
    });
  }, [refresh]);

  return {
    currentWorkspace,
    canView,
    loading,
    auditLogs,
    webhookDeliveries,
    publicApiRequests,
    outboundMessages,
    refresh,
  };
}
