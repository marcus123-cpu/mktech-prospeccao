import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { locationLabel } from "@/lib/research";
import { fmtDateTime } from "@/lib/time";
import { CancelSearchButton, InterruptSearchButton, RequestSearchForm } from "../execucoes/Pedido";
import { RunReport, type Report } from "../execucoes/RunReport";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hermes" };

type Dash = {
  researched: number; new_leads: number; existing_leads: number; with_contact: number; in_lists: number; active_campaigns: number;
  prepared: number; sent: number; delivered: number; replies: number; interested: number; proposals: number; negotiations: number; closed: number;
};
const TILES: { key: keyof Dash; label: string; hint?: string }[] = [
  { key: "researched", label: "Leads pesquisados", hint: "empresas analisadas pelo Hermes" },
  { key: "new_leads", label: "Leads novos", hint: "cadastrados nas pesquisas" },
  { key: "existing_leads", label: "Leads existentes", hint: "já estavam no CRM" },
  { key: "with_contact", label: "Leads com contato" },
  { key: "prepared", label: "Mensagens preparadas", hint: "na fila, ainda não enviadas" },
  { key: "sent", label: "Mensagens enviadas", hint: "saíram de verdade" },
  { key: "delivered", label: "Entregues", hint: "quando o WhatsApp confirma" },
  { key: "replies", label: "Respostas recebidas" },
  { key: "interested", label: "Interessados" },
  { key: "proposals", label: "Propostas" },
  { key: "negotiations", label: "Negociações" },
  { key: "closed", label: "Vendas fechadas", hint: "só com confirmação concreta" },
];
const PEDIDO: Record<string, string> = { pendente: "esperando o PC chamar o Hermes", em_andamento: "o Hermes está pesquisando", concluido: "terminou", cancelado: "cancelado" };

export default async function HermesPage() {
  const { supabase } = await requireAdmin();
  const [dash, pedidos] = await Promise.all([
    supabase.rpc("admin_prospecting_dashboard"),
    supabase.from("hermes_requests")
      .select("id,qualified_target,status,qualified_found,created_at,note,run_id,niche,location_scope,location_state,location_city")
      .order("created_at", { ascending: false }).limit(5),
  ]);
  if (dash.error || pedidos.error) return <><PageHeader title="Hermes" /><ErrorBox message="Não foi possível carregar o painel. Aplique as migrações 20261014170000 e 20261014180000." /></>;
  const d = dash.data as Dash;
  const list = pedidos.data ?? [];
  const aberto = list.find((p) => p.status === "pendente" || p.status === "em_andamento");
  const reports = new Map<string, Report>();
  for (const p of list.filter((x) => x.run_id && (x.status === "concluido" || x.status === "em_andamento")).slice(0, 3)) {
    const r = await supabase.rpc("admin_run_report", { p_run: p.run_id });
    if (!r.error && r.data) reports.set(p.id, r.data as Report);
  }
  return <>
    <PageHeader title="🚀 Hermes Prospector" subtitle="O Hermes pesquisa os leads e faz o diagnóstico. Depois você dispara só a saudação e conversa manualmente." />

    <section className="card mb-4 p-4">
      <h2 className="mb-2 font-semibold">Nova pesquisa</h2>
      <RequestSearchForm disabled={!!aberto} />
      {aberto && <p className="mt-2 text-xs text-amber-300">Já existe uma pesquisa {PEDIDO[aberto.status]}. Espere terminar ou cancele para iniciar outra.</p>}
      <ul className="mt-4 divide-y divide-line text-sm">
        {list.map((p) => (
          <li key={p.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{p.niche ?? "nicho das configurações"}</b> · {locationLabel(p)} · meta {p.qualified_target}
                <span className="text-xs text-muted"> · {fmtDateTime(p.created_at)} · {PEDIDO[p.status] ?? p.status}</span>
                {p.status === "concluido" && <span className="text-xs text-muted"> · vieram {p.qualified_found ?? 0}</span>}
              </span>
              {p.status === "pendente" && <CancelSearchButton id={p.id} />}
                {p.status === "em_andamento" && <InterruptSearchButton id={p.id} />}
            </div>
            {reports.get(p.id) && <RunReport report={reports.get(p.id)!} />}
          </li>
        ))}
      </ul>
    </section>

    <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((t) => (
        <div key={t.key} className="card p-3" title={t.hint}>
          <p className="text-2xl font-semibold">{Number(d[t.key] ?? 0).toLocaleString("pt-BR")}</p>
          <p className="text-xs text-muted">{t.label}</p>
        </div>
      ))}
    </section>

    <nav className="flex flex-wrap gap-3 text-sm">
      <Link href="/disparo" className="btn-ghost">📤 Disparar</Link>
      <Link href="/execucoes" className="btn-ghost">🤖 Histórico das pesquisas</Link>
    </nav>
  </>;
}
