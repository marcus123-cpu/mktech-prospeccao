import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/conversas/audio/{externalId}[?baixar=1] — só administradores logados.
// Redireciona para um link temporário do Storage (aceita avanço no player).
export async function GET(request: Request, { params }: { params: Promise<{ externalId: string }> }) {
  const { supabase } = await requireAdmin();
  const { externalId } = await params;
  const id = decodeURIComponent(externalId);
  const { data: row } = await supabase.from("chat_audio").select("storage_path, mime").eq("external_id", id).maybeSingle();
  if (!row) return new NextResponse("Áudio não encontrado", { status: 404 });
  const download = new URL(request.url).searchParams.has("baixar");
  const ext = row.storage_path.split(".").pop() ?? "ogg";
  const { data, error } = await serviceClient().storage.from("chat-audio")
    .createSignedUrl(row.storage_path, 300, download ? { download: `audio-whatsapp.${ext}` } : undefined);
  if (error || !data) return new NextResponse("Falha ao abrir o áudio", { status: 502 });
  return NextResponse.redirect(data.signedUrl, 302);
}
