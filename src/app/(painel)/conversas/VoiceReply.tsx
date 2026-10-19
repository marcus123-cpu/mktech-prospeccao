"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SECONDS = 600;
type Step = "idle" | "menu" | "recording" | "review";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Botão de microfone: gravar ao vivo ou escolher um arquivo de áudio; escuta a prévia antes de enviar como mensagem de voz. */
export function VoiceTool({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const discard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const stopTracks = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  const stopTimer = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; };
  useEffect(() => () => { discard.current = true; stopTimer(); stopTracks(); if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (step !== "menu") return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setStep("idle"); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [step]);

  function reset() {
    discard.current = true;
    stopTimer(); stopTracks();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    setFile(null); setStep("idle"); setError(""); setSeconds(0);
    if (input.current) input.current.value = "";
  }

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não grava áudio. Use “Enviar arquivo de áudio”."); setStep("idle"); return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
      chunks.current = []; discard.current = false;
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        stopTimer(); stopTracks();
        if (discard.current) return;
        const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks.current, { type });
        if (blob.size > MAX_BYTES) { setError("A gravação passou de 3 MB. Grave um áudio mais curto."); setStep("idle"); return; }
        if (!blob.size) { setError("Nada foi gravado. Tente de novo."); setStep("idle"); return; }
        setFile(new File([blob], `gravacao-${Date.now()}.${ext}`, { type }));
        setStep("review");
      };
      rec.start(1000);
      recorder.current = rec;
      setSeconds(0); setStep("recording");
      timer.current = window.setInterval(() => setSeconds(s => {
        if (s + 1 >= MAX_SECONDS && rec.state === "recording") rec.stop();
        return s + 1;
      }), 1000);
    } catch {
      stopTracks();
      setError("Não consegui usar o microfone. Libere a permissão do microfone no navegador (cadeado ao lado do endereço) e tente de novo.");
      setStep("idle");
    }
  }

  async function send() {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.set("lead_id", leadId); body.set("audio", file);
      const response = await fetch("/api/conversas/voz", { method: "POST", body });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Sua sessão expirou. Entre novamente no painel.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível preparar o áudio.");
      reset();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao enviar o áudio."); }
    finally { setBusy(false); }
  }

  const bubble = "absolute bottom-full left-0 right-0 border-t border-white/5 bg-[#202c33] p-3 shadow-[0_-14px_30px_-14px_rgb(0_0_0/0.7)]";
  return <>
    <button type="button" onClick={() => setStep(step === "menu" ? "idle" : step === "idle" ? "menu" : step)} aria-label="Mensagem de voz" title="Mensagem de voz"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${step === "recording" ? "animate-pulse bg-rose-600 text-white" : "text-[#aebac1] hover:bg-white/10 hover:text-white"}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
    </button>
    <input ref={input} type="file" hidden accept=".mp3,.m4a,.ogg,.wav,.webm,.aac,audio/*" onChange={event => {
      setError("");
      const selected = event.target.files?.[0] ?? null;
      if (!selected) return;
      if (selected.size > MAX_BYTES) { setError("O áudio deve ter até 3 MB."); event.target.value = ""; return; }
      discard.current = false; setFile(selected); setStep("review");
    }} />
    {step === "menu" && <div ref={box} role="menu" className="absolute bottom-full left-3 mb-1 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#233138] py-1 text-sm text-[#e9edef] shadow-2xl sm:left-auto sm:right-24">
      <button type="button" role="menuitem" onClick={start} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10"><span aria-hidden>🎙️</span>Gravar agora</button>
      <button type="button" role="menuitem" onClick={() => { setStep("idle"); input.current?.click(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10"><span aria-hidden>🎵</span>Enviar arquivo de áudio</button>
    </div>}
    {step === "recording" && <div className={bubble} role="status">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
        <span className="text-sm font-medium text-[#e9edef]">Gravando… <span className="tabular-nums">{clock(seconds)}</span></span>
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={reset} className="btn-ghost !px-3 !py-1.5 text-xs">Cancelar</button>
          <button type="button" onClick={() => recorder.current?.state === "recording" && recorder.current.stop()} className="btn-primary !px-3 !py-1.5 text-xs">⏹ Parar</button>
        </span>
      </div>
    </div>}
    {step === "review" && file && <div className={bubble}>
      <p className="mb-2 text-xs text-[#8696a0]">Escute antes de enviar · {file.name} · {(file.size / 1024).toFixed(0)} KB</p>
      {preview && <audio controls aria-label="Prévia da mensagem de voz" src={preview} className="w-full" preload="metadata" />}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={reset} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-xs">Descartar</button>
        <button type="button" onClick={send} disabled={busy} className="btn-primary !px-3 !py-1.5 text-xs">{busy ? "Enviando…" : "Enviar como mensagem de voz"}</button>
      </div>
    </div>}
    {error && <p role="alert" className="absolute bottom-full left-3 right-3 mb-1 rounded-lg bg-rose-900/90 px-3 py-2 text-xs text-white shadow-lg" onClick={() => setError("")}>{error}</p>}
  </>;
}
