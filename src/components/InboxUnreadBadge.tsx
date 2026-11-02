// Selo com o número de conversas com mensagens não lidas, ao lado do item "Inbox" do menu (mesmo visual do selo
// de aprendizados do Agente de IA).
import { useInboxUnreadCount } from "@/hooks/use-inbox-unread";

export function InboxUnreadBadge({ workspaceId }: { workspaceId: string }) {
  const { data } = useInboxUnreadCount(workspaceId);
  if (!data) return null;
  return (
    <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-brand-fg" aria-label={`${data} conversa(s) com mensagens não lidas`}>
      {data > 99 ? "99+" : data}
    </span>
  );
}
