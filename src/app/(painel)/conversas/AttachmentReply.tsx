"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachmentMime, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Botão de pasta: escolhe o arquivo, mostra na tela e deixa uma legenda para ir embaixo dele quando enviar. */
export function FileTool({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const kind = file ? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name) ? "video" : "doc") : null;

  useEffect(() => {
    if (!file || kind === "doc") { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, kind]);

  function close() {
    setFile(null); setCaption(""); setError("");
    if (input.current) input.current.value = "";
  }

  async function send() {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const call = async (body: unknown) => {
        const r = await fetch("/api/conversas/anexos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({})); if (!r.ok) throw Error(data.error ?? "Falha no envio."); return data;
      };
      const prepared = await call({ action: "prepare", lead_id: leadId, filename: file.name, bytes: file.size, ...(caption.trim() ? { caption: caption.trim() } : {}) });
      const { createClient } = await import("@/lib/supabase/browser");
      const uploaded = await createClient().storage.from("chat-attachments").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: prepared.mime });
      if (uploaded.error) throw Error("Falha no upload. Tente novamente.");
      await call({ action: "send", id: prepared.id });
      close();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha no envio."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" onClick={() => input.current?.click()} aria-label="Enviar vídeo, imagem ou arquivo" title="Enviar vídeo, imagem ou arquivo"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition hover:bg-white/10 hover:text-white">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
    </button>
    <input ref={input} type="file" hidden aria-label="Arquivo para enviar" accept=".mp4,.webm,.mov,.jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.pptx,.txt,.csv,.zip" onChange={event => {
      const selected = event.target.files?.[0] ?? null;
      if (!selected) return;
      if (selected.size > MAX_ATTACHMENT_BYTES || !attachmentMime(selected.name)) { setError("Formato não aceito ou arquivo maior que 30 MB."); event.target.value = ""; return; }
      setError(""); setCaption(""); setFile(selected);
    }} />
    {file && <div className="absolute bottom-full left-0 right-0 border-t border-white/5 bg-[#202c33] p-3 shadow-[0_-14px_30px_-14px_rgb(0_0_0/0.7)]">
      <div className="flex items-start gap-3">
        <div className="flex max-h-60 min-h-24 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/30">
          {kind === "image" && preview && /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt={file.name} className="max-h-60 max-w-full object-contain" />}
          {kind === "video" && preview && <video src={preview} controls className="max-h-60 max-w-full" />}
          {kind === "doc" && <div className="p-6 text-center"><div className="text-4xl" aria-hidden>📄</div><p className="mt-2 break-all text-sm text-[#e9edef]">{file.name}</p></div>}
        </div>
        <button type="button" onClick={close} disabled={busy} aria-label="Cancelar envio do arquivo" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#aebac1] hover:bg-white/10 hover:text-white">✕</button>
      </div>
      <p className="mt-2 truncate text-xs text-[#8696a0]">{file.name} · {size(file.size)}</p>
      <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={1000} rows={2} aria-label="Legenda do arquivo" placeholder="Adicione uma legenda (vai embaixo do arquivo)"
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
        className="mt-2 w-full resize-none rounded-xl border-0 bg-[#2a3942] px-4 py-2.5 text-[14px] text-[#e9edef] outline-none placeholder:text-[#8696a0]" />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-[#8696a0]">{caption.length}/1000</span>
        <button type="button" onClick={close} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-xs">Cancelar</button>
        <button type="button" onClick={send} disabled={busy} className="btn-primary !px-3 !py-1.5 text-xs">{busy ? "Enviando…" : "Enviar"}</button>
      </div>
    </div>}
    {error && <p role="alert" className="absolute bottom-full left-3 right-3 mb-1 rounded-lg bg-rose-900/90 px-3 py-2 text-xs text-white shadow-lg" onClick={() => setError("")}>{error}</p>}
  </>;
}
