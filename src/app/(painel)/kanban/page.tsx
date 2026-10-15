import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { Board, type Card } from "./Board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funil Kanban" };

export default async function KanbanPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("prospect_kanban")
    .select("lead_id,business_name,city,state,niche,fit_score,stage,lists")
    .order("moved_at", { ascending: false })
    .limit(1500);
  if (error) return <><PageHeader title="Funil Kanban" /><ErrorBox message="Não foi possível carregar o funil. Aplique a migração 20261014180000_listas_kanban_dashboard.sql." /></>;
  return <>
    <PageHeader title="🎯 Funil comercial" subtitle="Arraste os cards ou use o seletor. O Hermes atualiza as etapas pela conversa real; venda só fecha com valor e data confirmados por você." />
    <Board cards={(data ?? []) as Card[]} />
  </>;
}
