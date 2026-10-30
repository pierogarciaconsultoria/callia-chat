// Selo com a quantidade de aprendizados aguardando decisão, ao lado do item "Aprendizados" do menu.
import { usePendingLearningsCount } from "@/hooks/use-learnings";

export function PendingLearningsBadge({ workspaceId }: { workspaceId: string }) {
  const { data } = usePendingLearningsCount(workspaceId);
  if (!data) return null;
  return (
    <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-brand-fg" aria-label={`${data} aprendizado(s) pendente(s)`}>
      {data > 99 ? "99+" : data}
    </span>
  );
}
