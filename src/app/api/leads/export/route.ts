import { type NextRequest } from "next/server";
import { toCsv } from "@/lib/import";
import { ORIGIN_LABEL, PRIORITY_LABEL, SITE_LABEL, STAGE_LABEL, type Origin, type Priority, type SiteStatus, type Stage } from "@/lib/labels";
import { applyLeadFilters, type LeadFilters } from "@/lib/leads-query";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

// Exporta os leads filtrados em CSV (separador ;, UTF-8 com BOM para abrir no Excel).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return new Response("acesso negado", { status: 403 });
  const f = Object.fromEntries(request.nextUrl.searchParams) as LeadFilters;
  const all: Record<string, any>[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await applyLeadFilters(supabase.from("leads").select("*"), f).range(from, from + 999);
    if (error) return new Response("erro ao exportar", { status: 500 });
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const headers = [
    "Nome comercial", "Responsável", "Cidade", "UF", "Bairro", "Unidade", "Telefone original", "Telefone normalizado",
    "Instagram", "Link WhatsApp", "Site", "Verificação de site", "Prioridade", "Origem", "Etapa", "Contatado",
    "Primeiro contato", "Último contato", "Próximo retorno", "Valor proposta", "Valor fechado", "Data fechamento",
    "Motivo descarte/perda", "Motivo da seleção", "Pendências", "Cadastro",
  ];
  const rows = all.map((l) => [
    l.business_name, l.responsible_name, l.city, l.state, l.neighborhood, l.unit_label, l.phone_raw, l.phone_e164,
    l.instagram_handle, l.whatsapp_url, l.website_url, SITE_LABEL[l.site_status as SiteStatus],
    PRIORITY_LABEL[l.priority as Priority], ORIGIN_LABEL[l.origin as Origin], STAGE_LABEL[l.stage as Stage],
    l.contacted ? (l.contact_date_unknown ? "Sim (sem data)" : "Sim") : "Não",
    l.first_contact_at ? fmtDateTime(l.first_contact_at) : "", l.last_contact_at ? fmtDateTime(l.last_contact_at) : "",
    l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : "", l.proposal_value, l.closed_value,
    l.closed_at ? fmtDateTime(l.closed_at) : "", l.loss_reason, l.selection_reason, l.pending_items, fmtDateTime(l.created_at),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-mktech-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
