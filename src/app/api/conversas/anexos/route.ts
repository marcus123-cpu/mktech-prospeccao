import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { attachmentMime, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), lead_id: z.uuid(), filename: z.string().min(1).max(180), bytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES), caption: z.string().max(1000).optional() }),
  z.object({ action: z.literal("send"), id: z.uuid() }),
]);
const fail = (error: string, status = 422) => NextResponse.json({ error }, { status });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origem inválida.", 403);
  const { supabase } = await requireAdmin();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Arquivo inválido. O limite é 30 MB.");
  const db = serviceClient();
  const storage = db.storage.from("chat-attachments");
  const p = parsed.data;
  if (p.action === "prepare") {
    const mime = attachmentMime(p.filename);
    if (!mime) return fail("Use vídeo MP4/WebM/MOV, imagem, PDF, documento Office, TXT, CSV ou ZIP.", 415);
    const { data: lead, error } = await supabase.from("leads").select("phone_e164,do_not_contact").eq("id", p.lead_id).maybeSingle();
    if (error) return fail("Não foi possível conferir o contato.", 503);
    if (!lead?.phone_e164 || lead.do_not_contact) return fail("Contato indisponível.");
    const id = randomUUID(), path = `${id}/original`;
    const signed = await storage.createSignedUploadUrl(path);
    if (signed.error || !signed.data) return fail("Falha preparando o arquivo.", 503);
    const saved = await db.from("chat_attachments").insert({ id, lead_id: p.lead_id, storage_path: path, filename: p.filename.replace(/[\\/\u0000-\u001f]/g, "_"), mime, bytes: p.bytes, ...(p.caption?.trim() ? { caption: p.caption.trim() } : {}) });
    if (saved.error) return fail("Falha preparando o arquivo.", 503);
    return NextResponse.json({ id, path, token: signed.data.token, mime }, { status: 201 });
  }
  const { data: file } = await supabase.from("chat_attachments").select("*").eq("id", p.id).maybeSingle();
  if (!file) return fail("Anexo não encontrado.", 404);
  const listed = await storage.list(p.id, { limit: 1, search: "original" });
  const object = listed.data?.find(item => item.name === "original");
  if (listed.error || !object || Number(object.metadata?.size) !== file.bytes || object.metadata?.mimetype !== file.mime) return fail("O upload ainda não terminou ou o arquivo está inválido.");
  const queued = await supabase.rpc("admin_send_attachment", { p_id: p.id });
  if (queued.error) return fail("Não foi possível colocar o arquivo na fila.", 503);
  return NextResponse.json({ id: p.id, status: "enfileirada" }, { status: 201 });
}
