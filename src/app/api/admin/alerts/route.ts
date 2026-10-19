import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const alert = z.object({
  id: z.uuid(), message: z.string().min(1).max(2000), recovery: z.enum(["all", "retry", "review"]),
  scope: z.enum(["selected", "all"]), today: z.string().max(20), leads: z.array(z.uuid()).max(5000),
});

export async function GET() {
  const { supabase } = await requireAdmin();
  const [saved, failed] = await Promise.all([
    supabase.from("admin_alerts").select("id,message,recovery,context,created_at")
      .eq("kind", "disparo").is("dismissed_at", null).order("created_at", { ascending: false }).limit(20),
    supabase.from("commercial_outbox").select("id,lead_id,status,error,created_at")
      .in("status", ["falhou", "desconhecido"]).order("created_at", { ascending: false }).limit(20),
  ]);
  // Avisos que você já dispensou não voltam.
  const failedIds = (failed.data ?? []).map(row => row.id);
  const dismissed = failedIds.length ? await supabase.from("dismissed_send_issues").select("outbox_id").in("outbox_id", failedIds) : { data: [] as { outbox_id: string }[], error: null };
  const hidden = new Set((dismissed.data ?? []).map(row => row.outbox_id));
  if (saved.error || failed.error) return NextResponse.json({ error: "Avisos indisponíveis." }, { status: 503 });
  return NextResponse.json({ alerts: (saved.data ?? []).map(row => ({
    id: row.id, message: row.message, recovery: row.recovery, createdAt: row.created_at,
    scope: row.context?.scope ?? "selected", today: row.context?.today ?? "", leads: row.context?.leads ?? [],
  })), issues: (failed.data ?? []).filter(row => !hidden.has(row.id)).map(row => ({ id: row.id, leadId: row.lead_id,
    message: row.status === "desconhecido" ? "Resultado incerto: confira no WhatsApp antes de tentar de novo." : `Envio falhou: ${row.error ?? "consulte a saúde do sistema"}`,
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const parsed = alert.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aviso inválido." }, { status: 422 });
  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.from("admin_alerts").upsert({
    id: parsed.data.id, user_id: user.id, kind: "disparo", message: parsed.data.message,
    recovery: parsed.data.recovery, context: { scope: parsed.data.scope, today: parsed.data.today, leads: parsed.data.leads },
  }, { onConflict: "id" });
  return NextResponse.json(error ? { error: "Não foi possível salvar o aviso." } : { ok: true }, { status: error ? 503 : 200 });
}

export async function DELETE(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const parsed = z.object({ id: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aviso inválido." }, { status: 422 });
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("admin_alerts").update({ dismissed_at: new Date().toISOString() }).eq("id", parsed.data.id);
  return NextResponse.json(error ? { error: "Não foi possível dispensar o aviso." } : { ok: true }, { status: error ? 503 : 200 });
}
