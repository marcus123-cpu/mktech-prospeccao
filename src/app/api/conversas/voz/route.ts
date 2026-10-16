import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const MAX = 3 * 1024 * 1024;
const MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", webm: "audio/webm", aac: "audio/aac" };
const fail = (error: string, status = 422) => NextResponse.json({ error }, { status });
export async function POST(request: Request) {
  // A browser upload must originate on this application, using an admin session.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return fail("Origem inválida.", 403);
  const { supabase } = await requireAdmin();
  if (Number(request.headers.get("content-length") ?? 0) > MAX + 65536) return fail("O áudio deve ter até 3 MB.", 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return fail("Arquivo inválido."); }
  const lead = z.uuid().safeParse(form.get("lead_id"));
  const audio = form.get("audio");
  if (!lead.success || !(audio instanceof File)) return fail("Selecione um áudio e uma conversa.");
  if (!audio.size || audio.size > MAX) return fail("O áudio deve ter entre 1 byte e 3 MB.", 413);
  const mime = MIME[audio.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mime) return fail("Use MP3, M4A, OGG, WAV, WebM ou AAC.", 415);
  const { data: target, error: lookupError } = await supabase.from("leads").select("phone_e164,do_not_contact").eq("id", lead.data).maybeSingle();
  if (lookupError) return fail("Não foi possível conferir o contato.", 503);
  if (!target?.phone_e164 || target.do_not_contact) return fail("Este contato não pode receber mensagens.");
  const id = randomUUID();
  const path = `voice-outbox/${id}/original`;
  const storage = serviceClient().storage.from("chat-audio");
  const uploaded = await storage.upload(path, await audio.arrayBuffer(), { contentType: mime, upsert: false });
  if (uploaded.error) return fail("Não foi possível guardar o áudio. Tente novamente.", 503);
  const { error } = await supabase.rpc("admin_send_voice_reply", { p_lead: lead.data, p_id: id, p_path: path, p_mime: mime, p_bytes: audio.size });
  if (error) {
    await storage.remove([path]);
    return fail("Não foi possível colocar o áudio na fila. Atualize a conversa e tente novamente.", 503);
  }
  return NextResponse.json({ status: "enfileirada", id }, { status: 201 });
}
