import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("conversation_unread").select("id,business_name,last_in_at,last_in_body,last_in_media").order("last_in_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar os avisos." }, { status: 503 });
  return NextResponse.json({ conversations: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { supabase } = await requireAdmin();
  const parsed = z.object({ lead_id: z.uuid(), seen_at: z.iso.datetime({ offset: true }) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { error } = await supabase.rpc("mark_conversation_seen", { p_lead: parsed.data.lead_id, p_seen: parsed.data.seen_at });
  return NextResponse.json(error ? { error: "Não foi possível marcar como lida." } : { ok: true }, { status: error ? 503 : 200 });
}
