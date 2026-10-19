import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Dispensa um "Problema no envio" do sininho (só some para você; o envio continua registrado).
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aviso inválido." }, { status: 422 });
  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.from("dismissed_send_issues").upsert(parsed.data.ids.map(outbox_id => ({ user_id: user.id, outbox_id })), { onConflict: "user_id,outbox_id", ignoreDuplicates: true });
  return NextResponse.json(error ? { error: "Não foi possível dispensar o aviso." } : { ok: true }, { status: error ? 503 : 200 });
}
