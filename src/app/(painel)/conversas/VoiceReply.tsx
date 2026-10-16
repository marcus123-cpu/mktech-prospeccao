"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function VoiceReply({ leadId, disabled }: { leadId: string; disabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const body = new FormData();
      body.set("lead_id", leadId); body.set("audio", file);
      const response = await fetch("/api/conversas/voz", { method: "POST", body });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Sua sessão expirou. Entre novamente no painel.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível preparar o áudio.");
      setSuccess("Áudio na fila. Será enviado como mensagem de voz pelo WhatsApp conectado.");
      setFile(null); if (input.current) input.current.value = "";
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao enviar o áudio."); }
    finally { setBusy(false); }
  }
  if (disabled) return null;
  return <details className="shrink-0 border-t border-white/5 bg-[#202c33]"><summary className="cursor-pointer px-4 py-2 text-[11px] text-[#8696a0] hover:text-[#e9edef]">Enviar mensagem de voz</summary>
  <form onSubmit={send} className="space-y-3 p-3">
    <p className="text-xs text-muted">Anexe seu áudio, escute a prévia e envie. MP3, M4A, OGG, WAV ou WebM · até 3 MB e 10 minutos.</p>
    <input ref={input} id="voice-file" type="file" accept=".mp3,.m4a,.ogg,.wav,.webm,.aac,audio/*" disabled={busy}
      className="input w-full text-sm" onChange={event => {
        setError(""); setSuccess("");
        const selected = event.target.files?.[0] ?? null;
        if (selected && selected.size > 3 * 1024 * 1024) { setError("O áudio deve ter até 3 MB."); setFile(null); event.target.value = ""; return; }
        setFile(selected);
      }} />
    {preview && <audio controls aria-label="Prévia da mensagem de voz" src={preview} className="w-full" preload="metadata" />}
    <button className="btn-primary" disabled={!file || busy}>{busy ? "Preparando envio…" : "Enviar como mensagem de voz"}</button>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {success && <p role="status" className="text-sm text-emerald-300">{success}</p>}
  </form></details>;
}
