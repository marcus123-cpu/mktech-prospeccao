import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/conversas/manual/{id} — status leve de uma resposta enviada pelo painel.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 422 });
  const { data } = await supabase.from("manual_outbox").select("status, error").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json({ status: data.status, error: data.error }, { headers: { "Cache-Control": "no-store" } });
}
