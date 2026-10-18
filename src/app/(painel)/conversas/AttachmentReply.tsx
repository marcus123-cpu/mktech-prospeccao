"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachmentMime, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
export function AttachmentReply({ leadId, disabled }: {leadId: string; disabled: boolean}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  if (disabled) return null;
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file || busy) return;
    if (file.size > MAX_ATTACHMENT_BYTES || !attachmentMime(file.name)) { setMessage("Formato não aceito ou arquivo maior que 30 MB."); return; }
    setBusy(true); setMessage("");
    try {
      const call = async (body: unknown) => {
        const r = await fetch("/api/conversas/anexos", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
        const data = await r.json(); if (!r.ok) throw Error(data.error ?? "Falha no envio."); return data;
      };
      const prepared = await call({ action: "prepare", lead_id: leadId, filename: file.name, bytes: file.size });
      const { createClient } = await import("@/lib/supabase/browser");
      const uploaded = await createClient().storage.from("chat-attachments").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: prepared.mime });
      if (uploaded.error) throw Error("Falha no upload. Tente novamente.");
      await call({ action: "send", id: prepared.id });
      if (input.current) input.current.value = "";
      setMessage("Arquivo na fila de envio."); router.refresh();
    } catch(e) { setMessage(e instanceof Error ? e.message : "Falha no envio."); }
    finally { setBusy(false); }
  }
  return <details className="shrink-0 border-t border-white/5 bg-[#202c33]"><summary className="cursor-pointer px-4 py-2 text-xs text-[#aebac1]">📎 Enviar vídeo, imagem ou arquivo</summary><form onSubmit={upload} className="space-y-3 p-3"><p className="text-xs text-muted">Até 30 MB. Vídeos, imagens, PDF, Office, TXT, CSV e ZIP.</p><input aria-label="Arquivo para enviar" ref={input} type="file" disabled={busy} accept=".mp4,.webm,.mov,.jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.pptx,.txt,.csv,.zip" className="input" /><button disabled={busy} className="btn-primary">{busy ? "Enviando arquivo…" : "Enviar arquivo"}</button>{message && <p role="status" className="text-xs text-muted">{message}</p>}</form></details>;
}
